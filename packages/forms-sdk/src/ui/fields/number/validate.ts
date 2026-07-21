import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

export function validateNumber(
  field: ControlFieldOf<'number'>,
  ctx: FieldValidateCtx,
): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  const n = Number(String(value));
  if (Number.isNaN(n)) return 'must be a number';
  const rules = field.validation;
  if (rules?.integer && !Number.isInteger(n)) return 'must be a whole number';
  if (rules?.min !== undefined && n < rules.min) return `must be at least ${rules.min}`;
  if (rules?.max !== undefined && n > rules.max) return `must be at most ${rules.max}`;
  if (rules?.step !== undefined && rules.step > 0) {
    const base = rules.min ?? 0;
    const steps = (n - base) / rules.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      return `must be a multiple of ${rules.step}`;
    }
  }
  return null;
}
