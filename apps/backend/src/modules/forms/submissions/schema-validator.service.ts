import { Injectable } from '@nestjs/common';
import { isEmpty } from '@ratio-app/shared/schemas/fields/_shared/empty-constants';
import { type FormField, isCollectableFieldType } from '@ratio-app/shared/schemas/form-schema';
import { validateFiles } from './fields/file/validate';
import { serverFieldValidators } from './fields/registry';
import type { CollectableFormField, ServerFieldValidator, ValueFormField } from './fields/types';

const isCollectableField = (field: FormField): field is CollectableFormField =>
  isCollectableFieldType(field.type);

export type SchemaValidationResult =
  | {
      ok: true;
      /** Schema-known fields only, values normalized (phone → +91…). */
      data: Record<string, unknown>;
      /** Schema-known file fields only: field key → S3 object key, or key array when `maxFiles > 1`. */
      files: Record<string, string | string[]>;
    }
  | { ok: false; errors: Record<string, string> };

/** Server-side re-validation of a submission against the form's persisted `schema_json` (PublicFormGuard step 5; PRD F4–F6, F11, F13); unknown field keys are rejected to prevent mass-assignment. */
@Injectable()
export class SchemaValidatorService {
  validate(
    schema: FormField[],
    fields: Record<string, unknown>,
    files: Record<string, string | string[]> | undefined,
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
    const outFiles: Record<string, string | string[]> = {};

    for (const field of schema) {
      // Content blocks (§1.3) are display-only: no required-check, no value, no data_json entry.
      if (!isCollectableField(field)) continue;

      // When set, replaces the humanized default for any failure on this field (matches the SDK client validator).
      const custom = field.errorMessage;

      if (field.type === 'file') {
        const result = validateFiles(field, files?.[field.key], scope);
        if (result.error) {
          errors[field.key] = custom ?? result.error;
        } else if (result.value !== undefined) {
          outFiles[field.key] = result.value;
        }
        continue;
      }

      const value = fields[field.key];
      if (isEmpty(value)) {
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

  private validateValue(
    field: ValueFormField,
    value: unknown,
  ): { value?: unknown; error?: string } {
    // Cast widens the per-member validator to the union for the dynamic dispatch.
    const validator = serverFieldValidators[field.type] as ServerFieldValidator<
      ValueFormField['type']
    >;
    return validator(field, value);
  }
}
