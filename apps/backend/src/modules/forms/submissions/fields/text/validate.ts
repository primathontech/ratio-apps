import {
  applyTextTransform,
  FORM_TEXT_HARD_MAX_LENGTH,
  textFormatPattern,
} from '@ratio-app/shared/schemas/fields/text/constants';
import type { FieldOfType, ServerValidateResult } from '../types';
import { matchesPattern } from './regex-engine';

/**
 * Hard ceiling on the input fed to a merchant-authored regex on the public
 * submit path (P1-1 ReDoS defense in depth). The pattern itself is matched with
 * RE2 (linear-time, backtracking-immune — see ./regex-engine), which is the
 * definitive fix; this cap is a cheap secondary bound. Reuses the shared text
 * length ceiling so the two can't drift.
 */
const REGEX_INPUT_MAX_LENGTH = FORM_TEXT_HARD_MAX_LENGTH;

export function validateText(field: FieldOfType<'text'>, value: unknown): ServerValidateResult {
  if (typeof value !== 'string') return { error: 'Please enter a valid value.' };
  const v = field.validation;

  // Server-authoritative normalization: apply BEFORE any length/pattern check
  // and return the canonical value, regardless of what the client sent.
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

  // Format preset: a server-authored, vetted pattern → native RegExp('u') is
  // safe (fixed, backtracking-free) even on the public path.
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

  // Always-on ceiling (defense in depth) even when nothing was configured —
  // reached only when neither an explicit maxLength nor a pattern already bounded
  // the length above.
  if (canonical.length > FORM_TEXT_HARD_MAX_LENGTH) {
    return { error: `Please enter no more than ${FORM_TEXT_HARD_MAX_LENGTH} characters.` };
  }

  return { value: canonical };
}
