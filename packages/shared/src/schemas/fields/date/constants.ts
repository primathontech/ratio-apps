/** Zod-free date helper: backs the regex-only ISO shape with a real calendar check that agrees with both submit-time validators; Zod-free so it stays out of the widget bundle. */
export const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Round-trips the components through Date.UTC to reject impossible days like 2026-02-30 (no silent month rollover), matching both submit-time validators. */
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
