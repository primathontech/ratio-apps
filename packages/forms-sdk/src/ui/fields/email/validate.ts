import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

/** Mirrors the backend SchemaValidatorService (client-side pre-validation). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(
  field: ControlFieldOf<'email'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  return EMAIL_RE.test(String(value)) ? null : 'must be a valid email address';
}
