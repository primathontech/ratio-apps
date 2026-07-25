import {
  canonicalizePhone,
  phoneErrorMessage,
  resolvePhoneCountries,
} from '@ratio-app/shared/schemas/fields/phone/constants';
import type { FieldOfType, ServerValidateResult } from '../types';

/**
 * Server-authoritative phone validation. Regardless of what the client sent,
 * we resolve the field's country set (default IN when unconfigured), enforce
 * the per-country national-number length/charset, and RETURN the canonical
 * E.164 value (`+<dial><national>`). A client that bypasses the widget and
 * POSTs a wrong-length or wrong-country number is rejected here.
 */
export function validatePhone(field: FieldOfType<'phone'>, value: unknown): ServerValidateResult {
  const { codes, defaultCode } = resolvePhoneCountries(
    field.countries?.allowed,
    field.countries?.default,
  );
  const result = canonicalizePhone(value, codes, defaultCode);
  if ('empty' in result) {
    // Only a dial code, no national digits: honor required here (the upstream
    // isEmpty check does not treat a bare "+91" as empty).
    return field.required ? { error: 'This field is required.' } : { value: '' };
  }
  if ('error' in result) {
    return { error: phoneErrorMessage(codes, defaultCode) };
  }
  return { value: result.value };
}
