import { z } from 'zod';
import { baseFieldShape } from '../_shared/base';

/** Upload allowlist — presigned PUTs are constrained to exactly these. */
export const FORM_FILE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type FormFileAllowedMimeType = (typeof FORM_FILE_ALLOWED_MIME_TYPES)[number];

/** Hard upload ceiling — 5 MB (PRD F2/F3; S3 content-length-range). */
export const FORM_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Hard ceiling on how many files ONE file field may accept — a bounded cap on
 * the optional `maxFiles` key so a form can never request an unbounded fan-out
 * of presigned PUTs / signed GETs per submission. `maxFiles` defaults to 1
 * (single-file — byte-identical to the pre-multi behavior); values 2..10 opt
 * the field into the multi-file dropzone.
 */
export const FORM_FILE_MAX_FILES = 10;

/** file: mime allowlist (subset of the platform allowlist) + size cap ≤ 5MB. */
const fileValidationSchema = z.object({
  allowedMimeTypes: z
    .array(z.enum(FORM_FILE_ALLOWED_MIME_TYPES))
    .min(1, { message: 'at least one allowed file type is required' })
    .default([...FORM_FILE_ALLOWED_MIME_TYPES]),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(FORM_FILE_MAX_BYTES, { message: 'maxBytes cannot exceed 5MB' })
    .default(FORM_FILE_MAX_BYTES),
});

export const fileFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('file'),
  validation: fileValidationSchema.default({
    allowedMimeTypes: [...FORM_FILE_ALLOWED_MIME_TYPES],
    maxBytes: FORM_FILE_MAX_BYTES,
  }),
  // Multi-file: how many files the field accepts (§4 structural). ABSENT ⇒ 1 =
  // today's single-file behavior — the widget renders the same lone
  // `<input type="file">` and the submission stores a scalar object key. Values
  // 2..FORM_FILE_MAX_FILES opt into the multi-select dropzone and store a
  // `string[]` of object keys. Bounded so a form can't request an unbounded
  // number of uploads. Optional (not `.default`): a zod default would make
  // `maxFiles` required in the inferred output type and force every file-field
  // literal (admin builder defaults, fixtures) to set it — mirrors the hidden
  // field's `source`. Every consumer treats an absent value as 1.
  maxFiles: z.number().int().min(1).max(FORM_FILE_MAX_FILES).optional(),
});
