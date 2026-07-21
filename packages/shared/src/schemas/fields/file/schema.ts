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
});
