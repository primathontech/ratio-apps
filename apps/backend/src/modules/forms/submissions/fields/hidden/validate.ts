import { HIDDEN_MAX_VALUE_LENGTH } from '@ratio-app/shared/schemas/fields/hidden/constants';
import type { FieldOfType, ServerValidateResult } from '../types';

/** Server-authoritative hidden values (§4): `constant`/`timestamp` are derived here and never trusted from the client (a crafted POST can't override them); client-captured sources (url_param/cookie/referrer/landing_url) accept the string, apply `fallback` when empty, and clamp to the length ceiling. */
export function validateHidden(field: FieldOfType<'hidden'>, value: unknown): ServerValidateResult {
  const clamp = (v: string): string =>
    v.length > HIDDEN_MAX_VALUE_LENGTH ? v.slice(0, HIDDEN_MAX_VALUE_LENGTH) : v;

  const source = field.source ?? 'url_param';

  // Server-derived sources: the canonical value is computed here, not trusted.
  if (source === 'constant') {
    return { value: clamp(field.constantValue ?? field.fallback ?? '') };
  }
  if (source === 'timestamp') {
    return { value: new Date().toISOString() };
  }

  // Client-captured sources. A non-string means nothing was captured — fall
  // back if configured, otherwise reject as malformed (preserves prior behavior).
  if (typeof value !== 'string') {
    if (field.fallback !== undefined) return { value: clamp(field.fallback) };
    return { error: 'Please provide a valid value.' };
  }

  const resolved = value === '' && field.fallback !== undefined ? field.fallback : value;
  if (resolved.length > HIDDEN_MAX_VALUE_LENGTH) {
    return { error: `Please enter no more than ${HIDDEN_MAX_VALUE_LENGTH} characters.` };
  }
  return { value: resolved };
}
