import type { FormField, FormNonCollectableFieldType } from '@ratio-app/shared/schemas/form-schema';

/** Per-field server-validation contracts; each `./<type>/validate.ts` owns its rules and the registry dispatches to them. */

/** A field that carries user input (content blocks are display-only, §1.3). */
export type CollectableFormField = Exclude<FormField, { type: FormNonCollectableFieldType }>;

/** Value-bearing fields — every collectable field except `file` (a pre-uploaded S3 key, validated separately). */
export type ValueFormField = Exclude<CollectableFormField, { type: 'file' }>;

/** The narrowed member for a single value-bearing field type. */
export type FieldOfType<K extends ValueFormField['type']> = Extract<ValueFormField, { type: K }>;

/** Outcome of validating one submitted value: either a normalized value or an error. */
export interface ServerValidateResult {
  value?: unknown;
  error?: string;
}

/** Signature of a per-field server validator. */
export type ServerFieldValidator<K extends ValueFormField['type']> = (
  field: FieldOfType<K>,
  value: unknown,
) => ServerValidateResult;
