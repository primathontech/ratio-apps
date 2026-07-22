import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

const PHONE_RE = /^(\+91)?[0-9]{10}$/;

export function validatePhone(
  field: ControlFieldOf<'phone'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  const compact = String(value).replace(/[\s-]/g, '');
  return PHONE_RE.test(compact) ? null : 'must be a 10-digit Indian phone number';
}
