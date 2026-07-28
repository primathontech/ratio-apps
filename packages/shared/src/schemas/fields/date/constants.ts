/**
 * Zod-free date-field helper shared by the date field schema, so the regex-only
 * ISO shape is backed by a REAL calendar check that agrees with the submit-time
 * validators (server `submissions/fields/date/validate.ts` + SDK
 * `fields/date/validate.ts`). Deliberately Zod-free (mirrors the number/url
 * `*constants` modules + the `<type>/<...>constants` vite-alias pattern): safe
 * to import at runtime without pulling Zod into the widget bundle.
 */

/** Strict ISO calendar-date shape: 4-digit year, 2-digit month, 2-digit day. */
export const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a real ISO calendar date (`YYYY-MM-DD`). Rejects impossible days
 * like `2026-02-30` and non-ISO shapes like `July 2026` / `12/31/2026` by
 * round-tripping the components through `Date.UTC` and confirming they survive
 * (no silent rollover into the next month). Mirrors the round-trip both
 * submit-time validators use, so the schema and the validators agree.
 */
export function isRealCalendarDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
  );
}
