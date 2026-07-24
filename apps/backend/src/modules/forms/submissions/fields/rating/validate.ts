import type { FieldOfType, ServerValidateResult } from '../types';

export function validateRating(field: FieldOfType<'rating'>, value: unknown): ServerValidateResult {
  // Integer within 1..max (max is inline on the field, §4).
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num)) {
    return { error: 'Please enter a whole number.' };
  }
  if (num < 1 || num > field.max) {
    return { error: `Please choose a rating between 1 and ${field.max}.` };
  }
  return { value: num };
}
