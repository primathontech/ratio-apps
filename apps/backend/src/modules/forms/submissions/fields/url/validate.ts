import { normalizeBareDomainUrl } from '@ratio-app/shared/schemas/fields/url/constants';
import type { FieldOfType, ServerValidateResult } from '../types';

export function validateUrl(field: FieldOfType<'url'>, value: unknown): ServerValidateResult {
  // Format checked at submit-time (mirrors email); http/https only.
  if (typeof value !== 'string') return { error: 'Please enter a valid URL.' };
  const raw = value.trim();
  const rules = field.validation;
  if (rules?.maxLength !== undefined && raw.length > rules.maxLength) {
    return { error: `Please enter no more than ${rules.maxLength} characters.` };
  }
  // Normalize a bare domain (e.g. "example.com" → "https://example.com") so the
  // scheme may be omitted; the normalized (trimmed) value is what we store.
  const normalized = normalizeBareDomainUrl(raw);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { error: 'Please enter a valid URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Please enter a valid http or https URL.' };
  }
  if (rules?.requireHttps && parsed.protocol !== 'https:') {
    return { error: 'Please enter a valid https URL.' };
  }
  return { value: normalized };
}
