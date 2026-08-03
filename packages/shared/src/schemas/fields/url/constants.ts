/**
 * Zod-free URL field constants shared by the storefront SDK's url validator and
 * the backend submission validator, so a bare domain is normalized identically
 * on both sides (no scheme-detection drift). Deliberately Zod-free (mirrors
 * `select-constants.ts`): the SDK imports it at runtime and must not pull Zod
 * into the widget bundle.
 */

/** A leading scheme (`http:`, `ftp:`, `javascript:`, …). Absent ⇒ a bare domain
 * that gets `https://` prepended before validation. */
export const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Normalize a bare domain (e.g. "example.com" → "https://example.com") so the
 * scheme may be omitted. Inputs that already carry a scheme pass through. */
export function normalizeBareDomainUrl(raw: string): string {
  return HAS_SCHEME_RE.test(raw) ? raw : `https://${raw}`;
}
