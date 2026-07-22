import type { FormFieldType } from '@shared/schemas/form-schema';
import type { FieldSettingsComponent } from './_shared/controls';
import { CheckboxConsentSettings } from './checkbox/settings';
import { DividerSettings } from './divider/settings';
import { DropdownSettings } from './dropdown/settings';
import { FileValidationSettings } from './file/settings';
import { HeadingSettings } from './heading/settings';
import { HiddenSettings } from './hidden/settings';
import { ImageBlockSettings } from './image/settings';
import { MultiSelectSettings } from './multi_select/settings';
import { NumberValidationSettings } from './number/settings';
import { ParagraphSettings } from './paragraph/settings';
import { PhoneSettings } from './phone/settings';
import { RadioSettings } from './radio/settings';
import { RatingSettings } from './rating/settings';
import { TextValidationSettings } from './text/settings';
import { TextareaValidationSettings } from './textarea/settings';
import { UrlSettings } from './url/settings';

/**
 * Admin per-field settings registry (Phase 0 refactor). Maps each field type to
 * the settings panel it owns in `./<type>/settings.tsx`; `TypeSpecificSettings`
 * in `builder.$formId.tsx` dispatches through this map instead of a switch.
 * `email`/`date` have no type-specific panel (null). The `as` casts widen each
 * member-typed panel to the field union for the dynamic dispatch (mirrors the
 * SDK/server registry casts).
 */
export const fieldSettingsRegistry: Record<FormFieldType, FieldSettingsComponent | null> = {
  text: TextValidationSettings as FieldSettingsComponent,
  textarea: TextareaValidationSettings as FieldSettingsComponent,
  email: null,
  phone: PhoneSettings as FieldSettingsComponent,
  dropdown: DropdownSettings as FieldSettingsComponent,
  multi_select: MultiSelectSettings as FieldSettingsComponent,
  date: null,
  file: FileValidationSettings as FieldSettingsComponent,
  radio: RadioSettings as FieldSettingsComponent,
  checkbox: CheckboxConsentSettings as FieldSettingsComponent,
  number: NumberValidationSettings as FieldSettingsComponent,
  url: UrlSettings as FieldSettingsComponent,
  rating: RatingSettings as FieldSettingsComponent,
  hidden: HiddenSettings as FieldSettingsComponent,
  heading: HeadingSettings as FieldSettingsComponent,
  divider: DividerSettings as FieldSettingsComponent,
  paragraph: ParagraphSettings as FieldSettingsComponent,
  image: ImageBlockSettings as FieldSettingsComponent,
};
