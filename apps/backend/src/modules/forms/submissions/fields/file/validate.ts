import type { FormField } from '@ratio-app/shared/schemas/form-schema';

type FileField = Extract<FormField, { type: 'file' }>;

/** File fields arrive as pre-uploaded S3 keys; the key must be exactly `<merchantId>/<formId>/<draftId>/<fieldKey>` for THIS field — the prefix keeps cross-tenant/cross-form isolation (TDD §3.6) and the fieldKey suffix re-binds the object to this field's allowlist/size cap (P2-2), else a file uploaded for one field could satisfy another. Existence is checked separately ({@link validateFileExists}), since well-formed keys are guessable. */
export function validateFile(
  field: FileField,
  objectKey: string | undefined,
  scope: { merchantId: string; formId: string },
): string | null {
  if (objectKey === undefined || objectKey === '') {
    return field.required ? 'Please attach a file.' : null;
  }
  if (typeof objectKey !== 'string') return 'Please attach a valid file.';
  // Exactly four non-empty segments: merchantId / formId / draftId / fieldKey.
  const segments = objectKey.split('/');
  if (segments.length !== 4 || segments.some((s) => s === '')) {
    return 'This file does not belong to this form.';
  }
  const [merchantId, formId, , fieldKey] = segments;
  if (merchantId !== scope.merchantId || formId !== scope.formId) {
    return 'This file does not belong to this form.';
  }
  if (fieldKey !== field.key) {
    return 'This file was not uploaded for this field.';
  }
  return null;
}

/** Outcome of validating a file field's submitted value(s). */
export interface FileValidateResult {
  /** Object key(s) to persist, shaped to `maxFiles`: scalar `string` for single-file (byte-identical to pre-multi), `string[]` for multi-file. Absent when nothing attached. */
  value?: string | string[];
  error?: string;
}

/** Multi-file wrapper over {@link validateFile}: normalizes a single key or array, enforces `maxFiles`, and runs the per-key structural check on every key. Output shape is pinned to config (single-file→scalar so existing forms stay byte-identical, multi→array); a form saved before `maxFiles` treats missing as 1. */
export function validateFiles(
  field: FileField,
  raw: string | string[] | undefined,
  scope: { merchantId: string; formId: string },
): FileValidateResult {
  const maxFiles = field.maxFiles ?? 1;
  // Normalize to non-empty candidate keys — bare string (single-file) and array (multi-file) both funnel here.
  const keys = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
    (k) => k !== '' && k !== undefined && k !== null,
  );

  if (keys.length === 0) {
    return field.required ? { error: 'Please attach a file.' } : {};
  }
  if (keys.length > maxFiles) {
    return {
      error:
        maxFiles === 1
          ? 'Please attach a single file.'
          : `Please attach at most ${maxFiles} files.`,
    };
  }
  for (const key of keys) {
    const err = validateFile(field, key, scope);
    if (err) return { error: err };
  }
  // Single-file → scalar (byte-identical), multi-file → array; keys is non-empty here.
  const first = keys[0] as string;
  return { value: maxFiles > 1 ? keys : first };
}

/** Minimal object-existence dependency (satisfied by {@link FormsS3Service}). */
interface ObjectExistenceChecker {
  exists(objectKey: string): Promise<boolean>;
}

/** Async existence re-check (P2-2): confirm the structurally-valid key points at a real object before persisting a reference, so a fabricated well-formed key can't persist a phantom file. Called per accepted key from the submit path (`submissions.service.submitPublic`). */
export async function validateFileExists(
  objectKey: string,
  s3: ObjectExistenceChecker,
): Promise<string | null> {
  return (await s3.exists(objectKey)) ? null : 'The uploaded file could not be found.';
}
