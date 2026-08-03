import {
  applyTextTransform,
  FORM_TEXT_HARD_MAX_LENGTH,
  textFormatPattern,
} from '@ratio-app/shared/schemas/fields/text/constants';
import type { FieldOfType, ServerValidateResult } from '../types';
import { matchesPattern } from './regex-engine';

/** Hard input cap for merchant-regex matching on the public path (P1-1 defense in depth; RE2 in ./regex-engine is the real fix). Reuses the shared text ceiling so they can't drift. */
const REGEX_INPUT_MAX_LENGTH = FORM_TEXT_HARD_MAX_LENGTH;

export function validateText(field: FieldOfType<'text'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a valid value.' };
  const v = field.validation;

  // Server-authoritative: normalize BEFORE length/pattern checks and return the canonical value.
  const canonical = applyTextTransform(value, v?.transform);
  const invalid = v?.patternMessage ?? 'Please enter a valid value.';

  if (v?.minLength !== undefined && canonical.length < v.minLength) {
    return { error: `Please enter at least ${v.minLength} characters.` };
  }
  // Hard ceiling: a merchant-set maxLength can never exceed HARD_MAX.
  if (v?.maxLength !== undefined) {
    const max = Math.min(v.maxLength, FORM_TEXT_HARD_MAX_LENGTH);
    if (canonical.length > max) {
      return { error: `Please enter no more than ${max} characters.` };
    }
  }

  // Format preset is server-authored and fixed → native RegExp is safe on the public path.
  const preset = textFormatPattern(v?.format);
  if (preset !== undefined) {
    if (canonical.length > FORM_TEXT_HARD_MAX_LENGTH || !new RegExp(preset, 'u').test(canonical)) {
      return { error: invalid };
    }
  } else if (v?.pattern !== undefined) {
    // Merchant-authored pattern → RE2 (linear-time) + input cap.
    if (canonical.length > REGEX_INPUT_MAX_LENGTH || !matchesPattern(v.pattern, canonical)) {
      return { error: invalid };
    }
  }

  // Always-on ceiling (defense in depth) when neither maxLength nor a pattern bounded length above.
  if (canonical.length > FORM_TEXT_HARD_MAX_LENGTH) {
    return { error: `Please enter no more than ${FORM_TEXT_HARD_MAX_LENGTH} characters.` };
  }

  return { value: canonical };
}
