import type { FieldOfType, ServerValidateResult } from '../types';

export function validateCheckbox(
  field: FieldOfType<'checkbox'>,
  value: unknown,
): ServerValidateResult {
  // Single consent box: only a boolean is meaningful. A required box
  // must be ticked (unticked arrives as `false`, which isEmpty lets through).
  if (typeof value !== 'boolean') return { error: 'Please provide a valid response.' };
  if (field.required && !value) return { error: 'This field is required.' };
  return { value };
}
