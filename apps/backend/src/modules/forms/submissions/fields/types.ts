import type { FormField, FormNonCollectableFieldType } from '@ratio-app/shared/schemas/form-schema';

/**
 * Per-field server-validation contracts (Phase 0 refactor). Each field module
 * in `./<type>/validate.ts` owns the server-side rules that used to live in the
 * `validateValue` switch of `schema-validator.service.ts`; the registry
 * dispatches to them. Behavior is unchanged — this is a pure extraction.
 */

/** A field that carries user input (content blocks are display-only, §1.3). */
export type CollectableFormField = Exclude<FormField, { type: FormNonCollectableFieldType }>;

/** The value-bearing fields — every collectable field except `file` (which
 * arrives as a pre-uploaded S3 key and is validated separately). */
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
