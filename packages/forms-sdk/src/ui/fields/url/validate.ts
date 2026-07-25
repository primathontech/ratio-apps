import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

// A leading scheme (`http:`, `ftp:`, `javascript:`, …). Absent ⇒ a bare domain
// the server will normalize by prepending `https://` before validating.
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function validateUrl(field: ControlFieldOf<'url'>, ctx: FieldValidateCtx): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const raw = String(value).trim();
  const rules = field.validation;
  if (rules?.maxLength !== undefined && raw.length > rules.maxLength) {
    return `Please enter no more than ${rules.maxLength} characters.`;
  }
  // Normalize a bare domain the same way the server does (e.g. "example.com" →
  // "https://example.com"), then validate with the WHATWG URL parser so the
  // client and server accept exactly the same set (no regex/parser drift).
  const normalized = HAS_SCHEME_RE.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return 'Please enter a valid URL.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Please enter a valid http or https URL.';
  }
  if (rules?.requireHttps && parsed.protocol !== 'https:') {
    return 'Please enter a valid https URL.';
  }
  return null;
}
