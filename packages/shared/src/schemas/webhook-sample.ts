import {
  FORM_SUBMITTED_EVENT,
  FORM_SUBMITTED_SCHEMA_VERSION,
  type FormSubmittedPayload,
} from '../constants/forms-events';
import { optionValues } from './fields/_shared/base';
import { type FormField, isCollectableFieldType } from './form-schema';

/**
 * The single source of truth for what a `form.submitted` payload looks like.
 * Used by the backend "send test payload" AND the admin builder's "copy as
 * cURL" preview, so the example an integrator sees can never drift from a real
 * delivery. Because it is a pure function of the field list, the builder can
 * render it from live (even unsaved) state — the preview always reflects the
 * form's current fields.
 */

/**
 * A faithful example of the value a real submission stores for `field`: the
 * same TYPE the storefront submits, not just a string. Select fields emit the
 * option VALUE (not the label); number/rating emit numbers; checkbox a boolean.
 * Content blocks submit nothing (undefined) and are filtered out by callers.
 */
export function sampleFieldValue(field: FormField): unknown {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return `Sample ${field.label}`;
    case 'email':
      return 'shopper@example.com';
    case 'phone':
      return '+919876543210';
    case 'url':
      return 'https://example.com';
    case 'date':
      return '2026-01-01';
    case 'number':
      return 42;
    case 'rating':
      return Math.min(4, field.max);
    case 'checkbox':
      return true;
    case 'file':
      // A multi-file field (maxFiles > 1) delivers an ARRAY of signed URLs; a
      // single-file field a lone URL — mirror the real payload shape.
      return (field.maxFiles ?? 1) > 1
        ? [
            'https://files.example.com/uploads/sample-1.pdf',
            'https://files.example.com/uploads/sample-2.pdf',
          ]
        : 'https://files.example.com/uploads/sample.pdf';
    case 'hidden':
      return `sample-${field.paramName}`;
    case 'dropdown':
    case 'radio':
      return optionValues(field.options)[0];
    case 'multi_select':
      return optionValues(field.options).slice(0, 1);
    case 'heading':
    case 'divider':
    case 'paragraph':
    case 'image':
      return undefined;
    default:
      return assertNever(field);
  }
}

function assertNever(field: never): never {
  throw new Error(`unhandled field type: ${(field as FormField).type}`);
}

/** The `fields` map of a sample payload — one entry per collectable field, by key. */
export function buildSampleFields(fields: readonly FormField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isCollectableFieldType(field.type)) continue;
    out[field.key] = sampleFieldValue(field);
  }
  return out;
}

/** The dynamic envelope fields the caller supplies (real values on the server, examples in the builder). */
export interface SamplePayloadMeta {
  merchantId: string;
  formId: string;
  formName: string;
  submissionId: string;
  submittedAt: string;
}

/** A complete, schema-valid `form.submitted` sample payload for `fields`. */
export function buildSamplePayload(
  fields: readonly FormField[],
  meta: SamplePayloadMeta,
): FormSubmittedPayload {
  return {
    event: FORM_SUBMITTED_EVENT,
    merchant_id: meta.merchantId,
    form_id: meta.formId,
    form_name: meta.formName,
    submitted_at: meta.submittedAt,
    submission_id: meta.submissionId,
    schema_version: FORM_SUBMITTED_SCHEMA_VERSION,
    fields: buildSampleFields(fields),
  };
}

/** Wrap `s` in single quotes, escaping embedded single quotes for a POSIX shell. */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** A runnable `curl` that POSTs `payload` to `url`, mirroring a real delivery's headers. */
export function buildWebhookCurl(url: string, payload: FormSubmittedPayload): string {
  const body = JSON.stringify(payload, null, 2);
  return [
    `curl -X POST ${shellSingleQuote(url)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellSingleQuote(body)}`,
  ].join('\n');
}
