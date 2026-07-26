import type { FormField } from '@ratio-app/shared/schemas/form-schema';

type FileField = Extract<FormField, { type: 'file' }>;

/**
 * File fields arrive as pre-uploaded S3 object keys in `files`. The key MUST be
 * exactly `<merchantId>/<formId>/<draftId>/<fieldKey>` for THIS field:
 *
 *  - the `<merchantId>/<formId>/` prefix keeps cross-tenant/cross-form isolation
 *    (TDD §3.6), and
 *  - the trailing `<fieldKey>` segment must equal this field's key (P2-2).
 *
 * The suffix check is what re-binds the object to this field's per-field
 * allowlist/size cap: those constraints are enforced at presign time keyed to
 * the field the key was minted for, so a key ending in `avatar` can only exist
 * because `avatar`'s allowlist/cap were satisfied. Without it, a 5 MB PDF
 * uploaded for a `resume` field could be submitted for a png/1 MB `avatar`
 * field (the prefix alone matches), and one object could satisfy several file
 * fields at once.
 *
 * Object EXISTENCE is a separate, async step ({@link validateFileExists}): a
 * well-formed key is fully guessable (merchantId/formId/fieldKey are public), so
 * the structural checks here cannot tell a real upload from a fabricated key —
 * that needs an S3 HEAD (P2-2). Re-sniffing the stored bytes stays a documented
 * residual (needs a GET; the forced attachment Content-Disposition on serve is
 * the P2-3 backstop for a falsified content type).
 */
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
  /**
   * The object key(s) to persist, shape-matched to `maxFiles`: a scalar `string`
   * for a single-file field (byte-identical to the pre-multi behavior), a
   * `string[]` for a multi-file field. Absent when nothing was attached.
   */
  value?: string | string[];
  error?: string;
}

/**
 * Multi-file wrapper over {@link validateFile}. A file field's submitted value
 * is either a single object key (`string`) or, for a multi-file field
 * (`maxFiles > 1`), an array of keys — this normalizes both, enforces the
 * per-field `maxFiles` count, and runs the per-key structural check on EVERY
 * key so the same cross-tenant / cross-field guards apply to each uploaded file.
 *
 * Output shape is pinned to the field's configuration, not the submitted count:
 * a single-file field always persists a scalar (so existing single-file forms
 * stay byte-identical), a multi-file field always persists an array. A form
 * saved before `maxFiles` existed has no key on the field ⇒ treated as 1.
 */
export function validateFiles(
  field: FileField,
  raw: string | string[] | undefined,
  scope: { merchantId: string; formId: string },
): FileValidateResult {
  const maxFiles = field.maxFiles ?? 1;
  // Normalize to an array of non-empty candidate keys. A bare string (legacy /
  // single-file) and an array (multi-file) both funnel through here.
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
  // Single-file field → scalar (byte-identical); multi-file field → array.
  // keys is non-empty here (the length-0 branch returned above).
  const first = keys[0] as string;
  return { value: maxFiles > 1 ? keys : first };
}

/** Minimal object-existence dependency (satisfied by {@link FormsS3Service}). */
interface ObjectExistenceChecker {
  exists(objectKey: string): Promise<boolean>;
}

/**
 * Async existence re-check (P2-2): confirm the (already structurally validated)
 * object key actually points at an uploaded object before a submission stores a
 * reference to it. Without this, a fabricated but well-formed key would persist
 * a phantom file reference. Runs after {@link validateFile}, so it is only ever
 * a single HEAD per genuinely-present, well-formed key.
 *
 * Wiring note: the submit path (`submissions.service.submitPublic`) is the async
 * seam that calls this for each accepted file key; that module is out of scope
 * for this change, so this helper is exported ready to be awaited there.
 */
export async function validateFileExists(
  objectKey: string,
  s3: ObjectExistenceChecker,
): Promise<string | null> {
  return (await s3.exists(objectKey)) ? null : 'The uploaded file could not be found.';
}
