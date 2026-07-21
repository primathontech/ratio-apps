/**
 * SDK field-control registry (Phase 0 refactor). Maps each control field type
 * to its `{ render, validate }` module; `form-renderer.ts` dispatches
 * `renderControl` and `validateField` through this map instead of two switch
 * statements. Content blocks (heading/divider/paragraph/image) render via the
 * renderer's `renderBlock` and are not part of this registry.
 *
 * Zod-free by construction (only `lit` + type-only shared imports), so the
 * widget bundle never pulls Zod.
 */
import { renderCheckbox } from './checkbox/render';
import { validateCheckbox } from './checkbox/validate';
import { renderDate } from './date/render';
import { validateDate } from './date/validate';
import { renderDropdown } from './dropdown/render';
import { validateDropdown } from './dropdown/validate';
import { renderEmail } from './email/render';
import { validateEmail } from './email/validate';
import { renderFile } from './file/render';
import { validateFile } from './file/validate';
import { renderHidden } from './hidden/render';
import { validateHidden } from './hidden/validate';
import { renderMultiSelect } from './multi_select/render';
import { validateMultiSelect } from './multi_select/validate';
import { renderNumber } from './number/render';
import { validateNumber } from './number/validate';
import { renderPhone } from './phone/render';
import { validatePhone } from './phone/validate';
import { renderRadio } from './radio/render';
import { validateRadio } from './radio/validate';
import { renderRating } from './rating/render';
import { validateRating } from './rating/validate';
import { renderText } from './text/render';
import { validateText } from './text/validate';
import { renderTextarea } from './textarea/render';
import { validateTextarea } from './textarea/validate';
import type { ControlField, FieldControlModule } from './types';
import { renderUrl } from './url/render';
import { validateUrl } from './url/validate';

/** type → { render, validate }, exhaustive over the control field types. */
export const fieldControls: {
  [K in ControlField['type']]: FieldControlModule<K>;
} = {
  text: { render: renderText, validate: validateText },
  textarea: { render: renderTextarea, validate: validateTextarea },
  email: { render: renderEmail, validate: validateEmail },
  phone: { render: renderPhone, validate: validatePhone },
  dropdown: { render: renderDropdown, validate: validateDropdown },
  multi_select: { render: renderMultiSelect, validate: validateMultiSelect },
  date: { render: renderDate, validate: validateDate },
  file: { render: renderFile, validate: validateFile },
  radio: { render: renderRadio, validate: validateRadio },
  checkbox: { render: renderCheckbox, validate: validateCheckbox },
  number: { render: renderNumber, validate: validateNumber },
  url: { render: renderUrl, validate: validateUrl },
  rating: { render: renderRating, validate: validateRating },
  hidden: { render: renderHidden, validate: validateHidden },
};
