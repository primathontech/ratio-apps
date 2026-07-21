/**
 * Field-schema registry (Phase 0 per-field module refactor). Each per-field
 * module owns its Zod member in `<type>/schema.ts`; this barrel assembles them
 * in palette order (matching FORM_FIELD_TYPES) into the tuple that
 * `form-schema.ts` feeds to `z.discriminatedUnion('type', …)`.
 *
 * Members MUST stay plain ZodObjects — never wrapped in ZodEffects — so the
 * discriminated union stays a union of plain objects. Cross-field refines
 * (key uniqueness) live at the `formFieldsSchema` level in `form-schema.ts`.
 */
import { checkboxFieldSchema } from './checkbox/schema';
import { dateFieldSchema } from './date/schema';
import { dividerFieldSchema } from './divider/schema';
import { dropdownFieldSchema } from './dropdown/schema';
import { emailFieldSchema } from './email/schema';
import { fileFieldSchema } from './file/schema';
import { headingFieldSchema } from './heading/schema';
import { hiddenFieldSchema } from './hidden/schema';
import { imageFieldSchema } from './image/schema';
import { multiSelectFieldSchema } from './multi_select/schema';
import { numberFieldSchema } from './number/schema';
import { paragraphFieldSchema } from './paragraph/schema';
import { phoneFieldSchema } from './phone/schema';
import { radioFieldSchema } from './radio/schema';
import { ratingFieldSchema } from './rating/schema';
import { textFieldSchema } from './text/schema';
import { textareaFieldSchema } from './textarea/schema';
import { urlFieldSchema } from './url/schema';

/**
 * The discriminated-union members, in palette order. Declared as a tuple so
 * `z.discriminatedUnion` infers the exact union (not a widened array).
 */
export const fieldSchemaMembers = [
  textFieldSchema,
  textareaFieldSchema,
  emailFieldSchema,
  phoneFieldSchema,
  dropdownFieldSchema,
  multiSelectFieldSchema,
  dateFieldSchema,
  fileFieldSchema,
  radioFieldSchema,
  checkboxFieldSchema,
  numberFieldSchema,
  urlFieldSchema,
  ratingFieldSchema,
  hiddenFieldSchema,
  headingFieldSchema,
  dividerFieldSchema,
  paragraphFieldSchema,
  imageFieldSchema,
] as const;
