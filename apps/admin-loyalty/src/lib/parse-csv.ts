/**
 * Client-side bulk CSV parsing (PRD §Bulk Operations). Columns:
 * `phone_number, amount, reason?` with an optional header row. No CSV library
 * — a small quoted-field-aware splitter is all the format needs.
 *
 * Validation mirrors the server's ingest rules (phone shape, integer points
 * 1–100,000) so the preview counts match what the backend will accept. All
 * valid rows — including superseded duplicates — are shipped to the server,
 * which applies duplicate-phone last-wins; the preview totals reflect that
 * outcome up front.
 */

export interface BulkCsvRow {
  rowNumber: number;
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
}

const MIN_POINTS = 1;
const MAX_POINTS = 100_000;
const PHONE_RE = /^\+?\d{10,13}$/;

/** Split one CSV line into fields, honoring `"quoted, fields"` and `""` escapes. */
export function splitCsvLine(line: string): string[] {
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
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function looksLikeHeader(fields: string[]): boolean {
  const first = (fields[0] ?? '').trim().toLowerCase();
  const second = (fields[1] ?? '').trim().toLowerCase();
  return /phone/.test(first) || /amount|points|coins/.test(second);
}

export function parseBulkCsv(text: string): BulkCsvParseResult {
  const lines = text.split(/\r\n|\r|\n/);
  const rows: BulkCsvRow[] = [];
  const invalid: InvalidCsvRow[] = [];

  let rowNumber = 0;
  let headerChecked = false;
  for (const line of lines) {
    if (!line.trim()) continue; // blank lines never count
    const fields = splitCsvLine(line);
    if (!headerChecked) {
      headerChecked = true;
      if (looksLikeHeader(fields)) continue;
    }
    rowNumber++;

    const phoneRaw = (fields[0] ?? '').trim();
    const phone = phoneRaw.replace(/[\s-]/g, '');
    const amountRaw = (fields[1] ?? '').trim();
    const reason = (fields[2] ?? '').trim();

    if (!PHONE_RE.test(phone)) {
      invalid.push({ rowNumber, raw: line, error: 'Invalid phone number' });
      continue;
    }
    const points = Number(amountRaw);
    if (!Number.isFinite(points) || !Number.isInteger(points)) {
      invalid.push({ rowNumber, raw: line, error: 'Amount must be a whole number of coins' });
      continue;
    }
    if (points < MIN_POINTS || points > MAX_POINTS) {
      invalid.push({
        rowNumber,
        raw: line,
        error: `Amount must be between ${MIN_POINTS} and ${MAX_POINTS.toLocaleString()}`,
      });
      continue;
    }
    rows.push({ rowNumber, phone, points, ...(reason ? { reason } : {}) });
  }

  // Duplicate phones: last row wins (server behavior) — total accordingly.
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
