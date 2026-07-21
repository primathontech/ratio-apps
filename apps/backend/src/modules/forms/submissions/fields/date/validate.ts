import type { FieldOfType, ServerValidateResult } from '../types';

export function validateDate(_field: FieldOfType<'date'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return { error: 'must be a parseable date' };
  }
  return { value };
}
