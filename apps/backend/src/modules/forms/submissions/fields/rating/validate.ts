import type { FieldOfType, ServerValidateResult } from '../types';

export function validateRating(field: FieldOfType<'rating'>, value: unknown): ServerValidateResult {
  // Integer within min..max (both inline on the field, §4). min absent ⇒ 1
  // (1-based); 0 enables a 0-based scale (e.g. 0–10 NPS). Mirrors the client.
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num)) {
    return { error: 'Please enter a whole number.' };
  }
  const min = field.min ?? 1;
  if (num < min || num > field.max) {
    return { error: `Please choose a rating between ${min} and ${field.max}.` };
  }
  return { value: num };
}
