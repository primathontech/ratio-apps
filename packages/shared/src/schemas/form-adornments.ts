import type { FormFieldType } from './form-schema';

// ── Adornment capability matrix (§2.3) ─────────────────────────
// Single source of truth for which field types support which adornment, so the
// admin builder and the storefront SDK stay in lock-step instead of drifting.
// Deliberately Zod-free (only a type import from form-schema, erased at build):
// the storefront widget imports these at runtime and must not pull Zod into its
// bundle. form-schema re-exports them so they still surface next to the field
// schemas and FORM_NON_COLLECTABLE_FIELD_TYPES/isCollectableFieldType.

/**
 * Single-line, text-like inputs that support a static prefix/suffix chip.
 * Excludes textarea (multiline, chip has no baseline to sit on) and phone
 * (already carries its own +91 prefix chip).
 */
export const FORM_ADORNABLE_FIELD_TYPES = [
  'text',
  'email',
  'url',
  'number',
] as const satisfies readonly FormFieldType[];

/** Field types where a character counter is meaningful — they support a maxLength. */
export const FORM_COUNTER_FIELD_TYPES = [
  'text',
  'textarea',
] as const satisfies readonly FormFieldType[];

/** True when a field type can carry a prefix/suffix chip (§2.3). */
export const isAdornable = (type: FormFieldType): boolean =>
  (FORM_ADORNABLE_FIELD_TYPES as readonly FormFieldType[]).includes(type);

/** True when a character counter is meaningful for a field type (§2.3). */
export const supportsCounter = (type: FormFieldType): boolean =>
  (FORM_COUNTER_FIELD_TYPES as readonly FormFieldType[]).includes(type);
