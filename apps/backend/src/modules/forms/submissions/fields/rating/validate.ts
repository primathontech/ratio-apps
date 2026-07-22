import type { FieldOfType, ServerValidateResult } from '../types';

export function validateRating(field: FieldOfType<'rating'>, value: unknown): ServerValidateResult {
  // Integer within 1..max (max is inline on the field, §4).
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num)) {
    return { error: 'must be a whole number' };
  }
  if (num < 1 || num > field.max) {
    return { error: `must be between 1 and ${field.max}` };
  }
  return { value: num };
}
