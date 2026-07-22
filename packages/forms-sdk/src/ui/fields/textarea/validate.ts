import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

const TEXTAREA_DEFAULT_MAX = 5000;

export function validateTextarea(
  field: ControlFieldOf<'textarea'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const v = String(value);
  const rules = field.validation;
  const maxLength = rules?.maxLength ?? TEXTAREA_DEFAULT_MAX;
  if (rules?.minLength !== undefined && v.length < rules.minLength) {
    return `Please enter at least ${rules.minLength} characters.`;
  }
  if (v.length > maxLength) return `Please enter no more than ${maxLength} characters.`;
  return null;
}
