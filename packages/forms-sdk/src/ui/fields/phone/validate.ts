import {
  canonicalizePhone,
  phoneErrorMessage,
  resolvePhoneCountries,
} from '@ratio-app/shared/schemas/fields/phone/constants';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validatePhone(
  field: ControlFieldOf<'phone'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;

  const { codes, defaultCode } = resolvePhoneCountries(
    field.countries?.allowed,
    field.countries?.default,
  );
  const result = canonicalizePhone(String(value), codes, defaultCode);
  // Only a dial code selected (no national digits) ⇒ treat like empty so an
  // optional field passes; a required field still errors.
  if ('empty' in result) return field.required ? 'This field is required.' : null;
  if ('error' in result) return phoneErrorMessage(codes, defaultCode);
  return null;
}
