/**
 * RFC 4180 field escape. A field that contains a comma, double-quote, CR or LF
 * must be wrapped in double-quotes with every embedded quote doubled;
 * everything else is emitted verbatim. Pure and allocation-light — shared by
 * the forms submission export and the loyalty bulk / customer CSV writers so
 * the three call sites can't drift apart.
 */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
