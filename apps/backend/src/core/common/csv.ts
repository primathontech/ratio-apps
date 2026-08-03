/** RFC 4180 field escape: fields with comma, quote, CR or LF are wrapped in double-quotes with embedded quotes doubled; else emitted verbatim. */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
