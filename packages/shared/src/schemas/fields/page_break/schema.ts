import { z } from 'zod';
import { contentBlockBaseShape } from '../_shared/base';

/** Upper bound on a page_break's optional step title. Short, since it labels a
 * single step heading — bounded so only a plain string reaches the SDK. */
export const FORM_PAGE_BREAK_TITLE_MAX_LENGTH = 120;

/** page_break: a display-only layout separator that splits a form's fields into
 * multi-step pages (§steps). Modeled on `divider` — it carries no submitted
 * value and no required label, occupies the ordered schema_json array, and
 * honors the key uniqueness check. The block itself renders NOTHING in the form
 * body; it only marks a step boundary. `title` (optional) is the step's heading. */
export const pageBreakFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('page_break'),
  // Optional heading for the step this break opens. Absent ⇒ no title, just the
  // "Step X of N" progress text. Bounded so only a plain string is stored.
  title: z.string().min(1).max(FORM_PAGE_BREAK_TITLE_MAX_LENGTH).optional(),
});
