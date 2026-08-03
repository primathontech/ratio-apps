/**
 * Zod-free empty-value gate shared by the storefront SDK's value-bearing
 * control validators and the backend submission validator, so both sides treat
 * "empty" identically. Deliberately Zod-free (mirrors `select-constants.ts`):
 * the SDK imports it at runtime and must not pull Zod into the widget bundle.
 */
export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
