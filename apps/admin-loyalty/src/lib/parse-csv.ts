/**
 * Client-side bulk CSV parsing (PRD §Bulk Operations). Canonical columns:
 * `phone_number, amount, reason?` with an optional header row.
 *
 * The parser is deliberately forgiving about how the file reached us, because
 * merchants hand-build these in Excel/Sheets and a strict reader made the
 * whole upload look broken (every row landed in `invalid` with no explanation):
 *   - a UTF-8 BOM is stripped (Excel "CSV UTF-8" always writes one);
 *   - the delimiter is auto-detected (`,` `;` tab `|`) — Excel emits `;` under
 *     several European locales;
 *   - when a header row is present, columns are matched BY NAME, so
 *     `amount,phone_number` order works;
 *   - amounts tolerate thousand separators and a `₹` prefix (`"1,000"`, `₹500`)
 *     and trailing zero decimals (`500.00`), which Excel adds unprompted.
 *
 * Validation mirrors {@link file://../../../backend/src/modules/loyalty/common/normalize-phone.ts}
 * EXACTLY — phones are normalized to E.164 here, so the preview counts, the
 * duplicate detection, and the totals all match what the backend will do. A
 * looser client regex used to pass rows the server then rejected, and counted
 * `9876543210` and `+919876543210` as two different customers.
 */

export interface BulkCsvRow {
  rowNumber: number;
  /** E.164 (`+919876543210`) — already normalized, as the server would. */
  phone: string;
  points: number;
  reason?: string;
}

export interface InvalidCsvRow {
  rowNumber: number;
  raw: string;
  error: string;
}

export interface BulkCsvParseResult {
  /** Valid rows in file order (server applies duplicate last-wins). */
  rows: BulkCsvRow[];
  invalid: InvalidCsvRow[];
  /** Sum of points after duplicate-phone last-wins. */
  totalPoints: number;
  /** Earlier rows superseded by a later row with the same phone. */
  duplicateCount: number;
  uniquePhones: number;
  /** The separator actually used, for the "detected ; as separator" hint. */
  delimiter: string;
  /** True when a header row was recognized and skipped. */
  headerDetected: boolean;
}

const MIN_POINTS = 1;
const MAX_POINTS = 100_000;

/** Candidate separators, most likely first — ties resolve to the earlier one. */
const DELIMITERS = [',', ';', '\t', '|'] as const;

/** Header aliases per canonical column. Matched case/separator-insensitively. */
const HEADER_ALIASES = {
  phone: ['phone', 'phonenumber', 'phoneno', 'mobile', 'mobilenumber', 'mobileno', 'msisdn'],
  points: ['amount', 'points', 'coins', 'value', 'qty', 'quantity'],
  reason: ['reason', 'note', 'notes', 'description', 'comment', 'remarks'],
} as const;

/** The downloadable sample — what "Download sample CSV" hands the merchant. */
export const BULK_CSV_TEMPLATE = [
  'phone_number,amount,reason',
  '9876543210,500,Diwali bonus',
  '9876500000,250,Goodwill credit',
  '',
].join('\n');

export const BULK_CSV_TEMPLATE_FILENAME = 'loyalty-bulk-template.csv';

/**
 * Normalize an Indian phone number to E.164 (`+919876543210`).
 *
 * Kept byte-for-byte equivalent to the backend's `normalizePhone` so the
 * preview never promises a row the server will reject. Change both together.
 */
export function normalizeBulkPhone(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return null;

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length !== 10) return null;
  // Indian mobile numbers start 6-9.
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** Split one CSV line into fields, honoring `"quoted, fields"` and `""` escapes. */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Pick the separator that yields the most fields across the sample lines,
 * counting only occurrences OUTSIDE quotes (so `"holiday, bonus"` doesn't vote
 * for the comma). Falls back to `,` when nothing separates anything.
 */
export function detectDelimiter(lines: string[]): string {
  let best = ',';
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    for (const line of lines) {
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          // A doubled quote is an escaped literal, not a state change.
          if (inQuotes && line[i + 1] === '"') i++;
          else inQuotes = !inQuotes;
        } else if (!inQuotes && ch === delimiter) {
          count++;
        }
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = delimiter;
    }
  }
  return best;
}

/** `"Phone Number"` → `phonenumber`, so aliases match regardless of styling. */
function canonicalizeHeader(field: string): string {
  return field
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]/g, '');
}

interface ColumnMap {
  phone: number;
  points: number;
  reason: number | null;
}

const POSITIONAL_COLUMNS: ColumnMap = { phone: 0, points: 1, reason: 2 };

/**
 * Map a header row to column indices by name. Returns null when the row isn't
 * a header — which is the case whenever its first field is already a valid
 * phone number (a data row must never be swallowed as a header).
 */
export function mapHeader(fields: string[]): ColumnMap | null {
  if (normalizeBulkPhone(fields[0] ?? '')) return null;

  const canonical = fields.map(canonicalizeHeader);
  const indexOfAlias = (aliases: readonly string[]): number =>
    canonical.findIndex((name) => aliases.includes(name));

  const phone = indexOfAlias(HEADER_ALIASES.phone);
  const points = indexOfAlias(HEADER_ALIASES.points);
  const reason = indexOfAlias(HEADER_ALIASES.reason);

  // Both required columns named → trust the names entirely.
  if (phone !== -1 && points !== -1) {
    return { phone, points, reason: reason === -1 ? null : reason };
  }
  // Only one recognized (e.g. `phone,qty_of_coins`) — it's still a header row,
  // but fall back to positional so an unnamed column isn't lost.
  if (phone !== -1 || points !== -1 || reason !== -1) return POSITIONAL_COLUMNS;
  return null;
}

/**
 * Parse an amount cell. Tolerates Excel's thousand separators, a currency
 * prefix, and trailing zero decimals; rejects genuinely fractional coin
 * amounts. Returns null when the cell isn't a number at all.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/[₹$,\s]/g, '')
    .replace(/^\+/, '')
    // `500.00` → `500`, but leave `10.5` fractional so it fails validation.
    .replace(/\.0+$/, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function parseBulkCsv(text: string): BulkCsvParseResult {
  // Strip a UTF-8 BOM before anything else — otherwise it fuses onto the first
  // header/phone cell and invalidates row 1 (or the whole file).
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const nonEmpty = lines.filter((line) => line.trim());
  const delimiter = detectDelimiter(nonEmpty.slice(0, 20));

  const rows: BulkCsvRow[] = [];
  const invalid: InvalidCsvRow[] = [];

  let rowNumber = 0;
  let headerChecked = false;
  let headerDetected = false;
  let columns: ColumnMap = POSITIONAL_COLUMNS;

  for (const line of lines) {
    if (!line.trim()) continue; // blank lines never count
    const fields = splitCsvLine(line, delimiter);

    if (!headerChecked) {
      headerChecked = true;
      const mapped = mapHeader(fields);
      if (mapped) {
        headerDetected = true;
        columns = mapped;
        continue;
      }
    }
    rowNumber++;

    const phoneRaw = (fields[columns.phone] ?? '').trim();
    const amountRaw = (fields[columns.points] ?? '').trim();
    const reason = columns.reason === null ? '' : (fields[columns.reason] ?? '').trim();

    if (!phoneRaw) {
      invalid.push({ rowNumber, raw: line, error: 'Phone number is missing' });
      continue;
    }
    const phone = normalizeBulkPhone(phoneRaw);
    if (!phone) {
      invalid.push({
        rowNumber,
        raw: line,
        error: `"${phoneRaw}" is not a valid Indian mobile number (10 digits starting 6-9)`,
      });
      continue;
    }
    if (!amountRaw) {
      invalid.push({ rowNumber, raw: line, error: 'Amount is missing' });
      continue;
    }
    const points = parseAmount(amountRaw);
    if (points === null || !Number.isInteger(points)) {
      invalid.push({
        rowNumber,
        raw: line,
        error: `Amount "${amountRaw}" must be a whole number of coins`,
      });
      continue;
    }
    if (points < MIN_POINTS || points > MAX_POINTS) {
      invalid.push({
        rowNumber,
        raw: line,
        error: `Amount must be between ${MIN_POINTS} and ${MAX_POINTS.toLocaleString('en-IN')}`,
      });
      continue;
    }
    rows.push({ rowNumber, phone, points, ...(reason ? { reason } : {}) });
  }

  // Duplicate phones: last row wins (server behavior) — total accordingly.
  // Comparing normalized phones means format variants collapse correctly.
  const lastByPhone = new Map<string, BulkCsvRow>();
  for (const row of rows) lastByPhone.set(row.phone, row);
  let totalPoints = 0;
  for (const row of lastByPhone.values()) totalPoints += row.points;

  return {
    rows,
    invalid,
    totalPoints,
    duplicateCount: rows.length - lastByPhone.size,
    uniquePhones: lastByPhone.size,
    delimiter,
    headerDetected,
  };
}

/** Serialize rows to CSV text, quoting fields that need it. */
export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((field) => (/[",\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field))
        .join(','),
    )
    .join('\n');
}
