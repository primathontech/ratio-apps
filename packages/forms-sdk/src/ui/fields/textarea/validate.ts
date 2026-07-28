import { FORM_TEXTAREA_DEFAULT_MAX_LENGTH } from '@ratio-app/shared/schemas/fields/textarea/constants';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateTextarea(
  field: ControlFieldOf<'textarea'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const v = String(value);
  const rules = field.validation;
  const maxLength = rules?.maxLength ?? FORM_TEXTAREA_DEFAULT_MAX_LENGTH;
  if (rules?.minLength !== undefined && v.length < rules.minLength) {
    return `Please enter at least ${rules.minLength} characters.`;
  }
  if (v.length > maxLength) return `Please enter no more than ${maxLength} characters.`;
  return null;
}
