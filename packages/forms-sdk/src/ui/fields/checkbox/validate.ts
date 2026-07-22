import type { ControlFieldOf, FieldValidateCtx } from '../types';

export function validateCheckbox(
  field: ControlFieldOf<'checkbox'>,
  ctx: FieldValidateCtx,
): string | null {
  // Single consent: a boolean, so the generic isEmpty check does not apply.
  const checked = ctx.values[field.key] === true;
  return field.required && !checked ? 'this field is required' : null;
}
