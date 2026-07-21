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
  return { value: num };
}
