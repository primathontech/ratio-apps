import { Injectable } from '@nestjs/common';
import { type FormField, isCollectableFieldType } from '@ratio-app/shared/schemas/form-schema';
import { validateFile } from './fields/file/validate';
import { serverFieldValidators } from './fields/registry';
import type { CollectableFormField, ServerFieldValidator, ValueFormField } from './fields/types';

const isCollectableField = (field: FormField): field is CollectableFormField =>
  isCollectableFieldType(field.type);

export type SchemaValidationResult =
  | {
      ok: true;
      /** Schema-known fields only, values normalized (phone → +91…). */
      data: Record<string, unknown>;
      /** Schema-known file fields only: field key → S3 object key. */
      files: Record<string, string>;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * Server-side re-validation of a public submission against the form's
 * persisted `schema_json` (PublicFormGuard chain step 5). The shared
 * `form-schema` Zod contract validates the SCHEMA; this service validates a
 * SUBMISSION against that schema — required/regex/min-max/email/phone/
 * options-membership/date/textarea-cap/file-key rules per PRD F4–F6, F11,
 * F13.
 *
 * Per-field rules live in `./fields/<type>/validate.ts` and are dispatched via
 * the `serverFieldValidators` registry (Phase 0 module refactor).
 *
 * Unknown field keys are rejected (no mass-assignment): only keys the schema
 * declares may appear in `fields`/`files`, and only schema-known values are
 * returned for persistence.
 */
@Injectable()
export class SchemaValidatorService {
  validate(
    schema: FormField[],
    fields: Record<string, unknown>,
    files: Record<string, string> | undefined,
    scope: { merchantId: string; formId: string },
  ): SchemaValidationResult {
    const errors: Record<string, string> = {};
    const byKey = new Map(schema.map((f) => [f.key, f]));

    // Reject unknown keys up front — in both the value map and the file map.
    for (const key of Object.keys(fields)) {
      if (!byKey.has(key)) errors[key] = 'unknown field';
    }
    for (const key of Object.keys(files ?? {})) {
      const field = byKey.get(key);
      if (!field || field.type !== 'file') errors[key] = 'unknown file field';
    }

    const data: Record<string, unknown> = {};
    const outFiles: Record<string, string> = {};

    for (const field of schema) {
      // Content blocks (§1.3) are display-only: no required-check, no value,
      // no data_json entry. Any stray submitted value is silently dropped.
      if (!isCollectableField(field)) continue;

      // Merchant-authored custom message (§ production validation): when set it
      // replaces the humanized default for ANY failure on this field. The SDK
      // client validator applies the identical override, so client and server
      // return the same string.
      const custom = field.errorMessage;

      if (field.type === 'file') {
        const objectKey = files?.[field.key];
        const err = validateFile(field, objectKey, scope);
        if (err) {
          errors[field.key] = custom ?? err;
        } else if (objectKey) {
          outFiles[field.key] = objectKey;
        }
        continue;
      }

      const value = fields[field.key];
      if (this.isEmpty(value)) {
        if (field.required) errors[field.key] = custom ?? 'This field is required.';
        continue;
      }
      const result = this.validateValue(field, value);
      if (result.error !== undefined) {
        errors[field.key] = custom ?? result.error;
      } else {
        data[field.key] = result.value;
      }
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, data, files: outFiles };
  }

  private isEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  private validateValue(
    field: ValueFormField,
    value: unknown,
  ): { value?: unknown; error?: string } {
    // The registry is exhaustive over the value-bearing field types; the cast
    // widens the per-member validator to the union for the dynamic dispatch.
    const validator = serverFieldValidators[field.type] as ServerFieldValidator<
      ValueFormField['type']
    >;
    return validator(field, value);
  }
}
