import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateDate(field: ControlFieldOf<'date'>, ctx: FieldValidateCtx): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  return Number.isNaN(Date.parse(String(value))) ? 'must be a valid date' : null;
}
