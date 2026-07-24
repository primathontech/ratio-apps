import type { FieldOfType, ServerValidateResult } from '../types';
import { matchesPattern } from './regex-engine';

/**
 * Hard ceiling on the input fed to a merchant-authored regex on the public
 * submit path (P1-1 ReDoS defense in depth). The pattern itself is matched with
 * RE2 (linear-time, backtracking-immune — see ./regex-engine), which is the
 * definitive fix; this cap is a cheap secondary bound. A pattern-validated text
 * field is a name/code/postal-code — never this long — so a longer value simply
 * fails the pattern rather than running the regex.
 */
const REGEX_INPUT_MAX_LENGTH = 1000;

export function validateText(field: FieldOfType<'text'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a valid value.' };
  const v = field.validation;
  if (v?.minLength !== undefined && value.length < v.minLength) {
    return { error: `Please enter at least ${v.minLength} characters.` };
  }
  if (v?.maxLength !== undefined && value.length > v.maxLength) {
    return { error: `Please enter no more than ${v.maxLength} characters.` };
  }
  if (v?.pattern !== undefined) {
    if (value.length > REGEX_INPUT_MAX_LENGTH || !matchesPattern(v.pattern, value)) {
      return { error: 'Please enter a valid value.' };
    }
  }
  return { value };
}
