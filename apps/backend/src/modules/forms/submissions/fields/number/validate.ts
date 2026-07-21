import type { FieldOfType, ServerValidateResult } from '../types';

export function validateNumber(field: FieldOfType<'number'>, value: unknown): ServerValidateResult {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    return { error: 'must be a number' };
  }
  const v = field.validation;
  if (v?.integer && !Number.isInteger(num)) {
    return { error: 'must be a whole number' };
  }
  if (v?.min !== undefined && num < v.min) {
    return { error: `must be at least ${v.min}` };
  }
  if (v?.max !== undefined && num > v.max) {
    return { error: `must be at most ${v.max}` };
  }
  // step must be enforced server-side too (P2-4): value must be a whole number
  // of steps from the base (min, or 0 when unset), matching the client check.
  if (v?.step !== undefined && v.step > 0) {
    const base = v.min ?? 0;
    const steps = (num - base) / v.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      return { error: `must be a multiple of ${v.step}` };
    }
  }
  return { value: num };
}
