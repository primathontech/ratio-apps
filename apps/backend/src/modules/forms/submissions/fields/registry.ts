/**
 * Server-validation registry (Phase 0 refactor). Maps each value-bearing field
 * type to the per-field validator that owns its rules; `schema-validator.service`
 * dispatches through this map instead of a monolithic switch. `file` is
 * validated separately (it carries an S3 key + scope, not an inline value).
 */
import { validateCheckbox } from './checkbox/validate';
import { validateDate } from './date/validate';
import { validateDropdown } from './dropdown/validate';
import { validateEmail } from './email/validate';
import { validateHidden } from './hidden/validate';
import { validateMultiSelect } from './multi_select/validate';
import { validateNumber } from './number/validate';
import { validatePhone } from './phone/validate';
import { validateRadio } from './radio/validate';
import { validateRating } from './rating/validate';
import { validateText } from './text/validate';
import { validateTextarea } from './textarea/validate';
import type { ServerFieldValidator, ValueFormField } from './types';
import { validateUrl } from './url/validate';

/** type → per-field server validator, exhaustive over the value-bearing fields. */
export const serverFieldValidators: {
  [K in ValueFormField['type']]: ServerFieldValidator<K>;
} = {
  text: validateText,
  textarea: validateTextarea,
  email: validateEmail,
  phone: validatePhone,
  dropdown: validateDropdown,
  multi_select: validateMultiSelect,
  date: validateDate,
  radio: validateRadio,
  checkbox: validateCheckbox,
  number: validateNumber,
  url: validateUrl,
  rating: validateRating,
  hidden: validateHidden,
};
