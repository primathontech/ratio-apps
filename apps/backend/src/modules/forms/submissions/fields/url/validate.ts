import type { FieldOfType, ServerValidateResult } from '../types';

export function validateUrl(_field: FieldOfType<'url'>, value: unknown): ServerValidateResult {
  // Format checked at submit-time (mirrors email); http/https only.
  if (typeof value !== 'string') return { error: 'must be a string' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { error: 'must be a valid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'must be a valid http or https URL' };
  }
  return { value };
}
