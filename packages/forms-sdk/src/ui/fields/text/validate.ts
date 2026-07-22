import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateText(field: ControlFieldOf<'text'>, ctx: FieldValidateCtx): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  const v = String(value);
  const rules = field.validation;
  if (rules?.minLength !== undefined && v.length < rules.minLength) {
    return `must be at least ${rules.minLength} characters`;
  }
  if (rules?.maxLength !== undefined && v.length > rules.maxLength) {
    return `must be at most ${rules.maxLength} characters`;
  }
  if (rules?.pattern !== undefined && !new RegExp(rules.pattern).test(v)) {
    return 'does not match the required pattern';
  }
  return null;
}
