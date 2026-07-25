import {
  applyTextTransform,
  FORM_TEXT_HARD_MAX_LENGTH,
  textFormatPattern,
} from '@ratio-app/shared/schemas/fields/text/constants';
import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

/** Client-side mirror of the server verdict. Non-authoritative: a regex that
 * fails to compile is treated as passing here (the server decides). */
function matchesFormat(src: string, value: string): boolean {
  try {
    return new RegExp(src, 'u').test(value);
  } catch {
    return true;
  }
}

export function validateText(field: ControlFieldOf<'text'>, ctx: FieldValidateCtx): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'This field is required.' : null;
  const rules = field.validation;
  // Mirror the server: normalize before the length/pattern checks.
  const v = applyTextTransform(String(value), rules?.transform);
  const invalid = rules?.patternMessage ?? 'Please enter a valid value.';

  if (rules?.minLength !== undefined && v.length < rules.minLength) {
    return `Please enter at least ${rules.minLength} characters.`;
  }
  if (rules?.maxLength !== undefined) {
    const max = Math.min(rules.maxLength, FORM_TEXT_HARD_MAX_LENGTH);
    if (v.length > max) return `Please enter no more than ${max} characters.`;
  }
  const src = textFormatPattern(rules?.format) ?? rules?.pattern;
  if (src !== undefined && !matchesFormat(src, v)) return invalid;
  return null;
}
