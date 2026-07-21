import { Injectable } from '@nestjs/common';
import {
  FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  type FormField,
  type FormNonCollectableFieldType,
  isCollectableFieldType,
} from '@ratio-app/shared/schemas/form-schema';

/** Simple, deliberately-strict email shape (client mirrors it in the SDK). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** +91 10-digit phone (PRD v1): '+919876543210' or '9876543210'. */
const PHONE_RE = /^(\+91)?[0-9]{10}$/;

/** Cheap DoS guard on a captured hidden value (UTM etc, §4) — never user-typed. */
const HIDDEN_MAX_LENGTH = 2048;

/**
 * A field that carries user input. Content blocks (heading/divider/paragraph/
 * image, §1.3) are display-only and excluded here so they never reach the
 * required-check, the collection map, or the exhaustive value switch.
 */
type CollectableFormField = Exclude<FormField, { type: FormNonCollectableFieldType }>;

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

      if (field.type === 'file') {
        const objectKey = files?.[field.key];
        const err = this.validateFile(field, objectKey, scope);
        if (err) {
          errors[field.key] = err;
        } else if (objectKey) {
          outFiles[field.key] = objectKey;
        }
        continue;
      }

      const value = fields[field.key];
      if (this.isEmpty(value)) {
        if (field.required) errors[field.key] = 'this field is required';
        continue;
      }
      const result = this.validateValue(field, value);
      if (result.error !== undefined) {
        errors[field.key] = result.error;
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
    field: Exclude<CollectableFormField, { type: 'file' }>,
    value: unknown,
  ): { value?: unknown; error?: string } {
    switch (field.type) {
      case 'text': {
        if (typeof value !== 'string') return { error: 'must be a string' };
        const v = field.validation;
        if (v?.minLength !== undefined && value.length < v.minLength) {
          return { error: `must be at least ${v.minLength} characters` };
        }
        if (v?.maxLength !== undefined && value.length > v.maxLength) {
          return { error: `must be at most ${v.maxLength} characters` };
        }
        if (v?.pattern !== undefined && !new RegExp(v.pattern).test(value)) {
          return { error: 'does not match the required pattern' };
        }
        return { value };
      }
      case 'textarea': {
        if (typeof value !== 'string') return { error: 'must be a string' };
        const v = field.validation;
        const maxLength = v?.maxLength ?? FORM_TEXTAREA_DEFAULT_MAX_LENGTH;
        if (v?.minLength !== undefined && value.length < v.minLength) {
          return { error: `must be at least ${v.minLength} characters` };
        }
        if (value.length > maxLength) {
          return { error: `must be at most ${maxLength} characters` };
        }
        return { value };
      }
      case 'email': {
        if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
          return { error: 'must be a valid email address' };
        }
        return { value };
      }
      case 'phone': {
        if (typeof value !== 'string') return { error: 'must be a string' };
        const compact = value.replace(/[\s-]/g, '');
        if (!PHONE_RE.test(compact)) {
          return { error: 'must be a 10-digit Indian phone number (+91 optional)' };
        }
        // Normalize to +91XXXXXXXXXX.
        return { value: `+91${compact.slice(-10)}` };
      }
      case 'dropdown': {
        if (typeof value !== 'string' || !field.options.includes(value)) {
          return { error: 'must be one of the configured options' };
        }
        return { value };
      }
      case 'multi_select': {
        if (
          !Array.isArray(value) ||
          !value.every((v) => typeof v === 'string' && field.options.includes(v))
        ) {
          return { error: 'every selection must be one of the configured options' };
        }
        return { value };
      }
      case 'date': {
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          return { error: 'must be a parseable date' };
        }
        return { value };
      }
      case 'radio': {
        if (typeof value !== 'string' || !field.options.includes(value)) {
          return { error: 'must be one of the configured options' };
        }
        return { value };
      }
      case 'checkbox': {
        // Single consent box: only a boolean is meaningful. A required box
        // must be ticked (unticked arrives as `false`, which isEmpty lets through).
        if (typeof value !== 'boolean') return { error: 'must be a boolean' };
        if (field.required && !value) return { error: 'this field is required' };
        return { value };
      }
      case 'number': {
        const num = typeof value === 'string' ? Number(value) : value;
        if (typeof num !== 'number' || !Number.isFinite(num)) {
          return { error: 'must be a number' };
        }
        const v = field.validation;
        if (v?.integer && !Number.isInteger(num)) {
          return { error: 'must be a whole number' };
        }
        if (v?.min !== undefined && num < v.min) {
          return { error: `must be at least ${v.min}` };
        }
        if (v?.max !== undefined && num > v.max) {
          return { error: `must be at most ${v.max}` };
        }
        return { value: num };
      }
      case 'url': {
        // Format checked at submit-time (mirrors email); http/https only.
        if (typeof value !== 'string') return { error: 'must be a string' };
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          return { error: 'must be a valid URL' };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { error: 'must be a valid http or https URL' };
        }
        return { value };
      }
      case 'rating': {
        // Integer within 1..max (max is inline on the field, §4).
        const num = typeof value === 'string' ? Number(value) : value;
        if (typeof num !== 'number' || !Number.isInteger(num)) {
          return { error: 'must be a whole number' };
        }
        if (num < 1 || num > field.max) {
          return { error: `must be between 1 and ${field.max}` };
        }
        return { value: num };
      }
      case 'hidden': {
        // Captured from URLSearchParams client-side — accept the string, bound it.
        if (typeof value !== 'string') return { error: 'must be a string' };
        if (value.length > HIDDEN_MAX_LENGTH) {
          return { error: `must be at most ${HIDDEN_MAX_LENGTH} characters` };
        }
        return { value };
      }
    }
  }

  /**
   * File fields arrive as pre-uploaded S3 object keys in `files`. The key
   * MUST live under this merchant+form's prefix — a key from another
   * merchant's (or form's) prefix is rejected outright (TDD §3.6).
   */
  private validateFile(
    field: Extract<FormField, { type: 'file' }>,
    objectKey: string | undefined,
    scope: { merchantId: string; formId: string },
  ): string | null {
    if (objectKey === undefined || objectKey === '') {
      return field.required ? 'a file is required' : null;
    }
    if (typeof objectKey !== 'string') return 'must be an uploaded file key';
    if (!objectKey.startsWith(`${scope.merchantId}/${scope.formId}/`)) {
      return 'file does not belong to this form';
    }
    return null;
  }
}
