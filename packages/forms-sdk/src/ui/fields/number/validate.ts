import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateNumber(
  field: ControlFieldOf<'number'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const n = Number(String(value));
  if (Number.isNaN(n)) return 'Please enter a number.';
  const rules = field.validation;
  if (rules?.integer && !Number.isInteger(n)) return 'Please enter a whole number.';
  if (rules?.min !== undefined && n < rules.min)
    return `Please enter a value of ${rules.min} or more.`;
  if (rules?.max !== undefined && n > rules.max)
    return `Please enter a value of ${rules.max} or less.`;
  if (rules?.step !== undefined && rules.step > 0) {
    const base = rules.min ?? 0;
    const steps = (n - base) / rules.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      return `Please enter a multiple of ${rules.step}.`;
    }
  }
  return null;
}
