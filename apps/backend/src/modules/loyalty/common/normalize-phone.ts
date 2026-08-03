/**
 * Normalize an Indian phone number to E.164 (`+919876543210`).
 *
 * ONE normalization function for the whole module — every phone that touches
 * the DB, a Core Loyalty call, or an idempotency key goes through here, so a
 * customer can never split into two loyalty identities by formatting
 * (TRD §8 risk 2).
 *
 * Accepts: `9876543210`, `09876543210`, `919876543210`, `+919876543210`,
 * with any spaces/dashes/parentheses. Returns null for anything else.
 */
export function normalizePhone(raw: string): string | null {
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
