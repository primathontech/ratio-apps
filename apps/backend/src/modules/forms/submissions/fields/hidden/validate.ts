import { HIDDEN_MAX_VALUE_LENGTH } from '@ratio-app/shared/schemas/fields/hidden/constants';
import type { FieldOfType, ServerValidateResult } from '../types';

/**
 * Server-authoritative resolution of a captured hidden value (§4).
 *
 * The client resolves hidden values from page context and POSTs them, but the
 * server never trusts that for sources it can derive itself:
 *  - `constant`: emit the configured `constantValue` (or `fallback`), ignoring
 *    whatever the client sent — a crafted POST can't override a fixed constant.
 *  - `timestamp`: stamp the server's own ISO time, so the recorded time is
 *    authoritative rather than client-controlled.
 * For client-captured sources (url_param/cookie/referrer/landing_url) the value
 * genuinely originates in the browser: accept the string, apply the `fallback`
 * when it's empty, and enforce the length ceiling regardless of the client.
 */
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
