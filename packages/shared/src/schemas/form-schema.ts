import { z } from 'zod';

/**
 * The keystone Zod contract of the Form Builder (TRD §5): the schema of a
 * form definition itself. ONE schema validates in three places — the admin
 * builder (react-hook-form), the backend (form CRUD DTO +
 * schema-validator.service), and the storefront SDK (submission
 * pre-validation). Keep it dependency-free: plain Zod, no backend imports.
 */

/** The 8 supported field types, in palette order. */
export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'phone',
  'dropdown',
  'multi_select',
  'date',
  'file',
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

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

/** Textarea length: 5,000 default, merchant-raisable to 10,000 (PRD F13). */
export const FORM_TEXTAREA_DEFAULT_MAX_LENGTH = 5000;
export const FORM_TEXTAREA_HARD_MAX_LENGTH = 10000;

/**
 * Field key — becomes the JSON key in `data_json`, the CSV header, and the
 * `fields` key of the `form.submitted` payload. Machine-safe by construction.
 */
export const formFieldKeySchema = z
  .string()
  .min(1, { message: 'field key is required' })
  .max(64, { message: 'field key must be at most 64 characters' })
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message: 'field key must start with a letter and contain only letters, digits, and underscores',
  });

/** Shared per-field basics — every field type carries these. */
const baseFieldShape = {
  key: formFieldKeySchema,
  label: z.string().min(1, { message: 'label is required' }).max(255),
  placeholder: z.string().max(255).optional(),
  required: z.boolean().default(false),
};

/** A merchant-supplied validation regex — must compile. */
const regexPatternSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (pattern) => {
      try {
        new RegExp(pattern);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'pattern must be a valid regular expression' },
  );

const minMaxConsistent = (v: {
  minLength?: number | undefined;
  maxLength?: number | undefined;
}): boolean => v.minLength === undefined || v.maxLength === undefined || v.minLength <= v.maxLength;

const MIN_MAX_MESSAGE = { message: 'minLength must be less than or equal to maxLength' };

/** text: optional regex + length bounds. */
const textValidationSchema = z
  .object({
    pattern: regexPatternSchema.optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

/** textarea: length bounds; max defaults to 5,000 and is capped at 10,000. */
const textareaValidationSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z
      .number()
      .int()
      .min(1)
      .max(FORM_TEXTAREA_HARD_MAX_LENGTH, {
        message: `textarea maxLength cannot exceed ${FORM_TEXTAREA_HARD_MAX_LENGTH}`,
      })
      .default(FORM_TEXTAREA_DEFAULT_MAX_LENGTH),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

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

/** dropdown / multi_select choices — at least one non-empty option. */
const optionsSchema = z
  .array(z.string().min(1, { message: 'options cannot be empty strings' }))
  .min(1, { message: 'at least one option is required' });

const textFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('text'),
  validation: textValidationSchema.optional(),
});

const textareaFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('textarea'),
  validation: textareaValidationSchema.default({
    maxLength: FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  }),
});

/** Email format is enforced at submit-time; no extra config beyond basics. */
const emailFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('email'),
});

/** Phone is +91 + 10 digits in v1 — enforced at submit-time, no config here. */
const phoneFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('phone'),
});

const dropdownFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('dropdown'),
  options: optionsSchema,
});

const multiSelectFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('multi_select'),
  options: optionsSchema,
});

const dateFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('date'),
});

const fileFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('file'),
  validation: fileValidationSchema.default({
    allowedMimeTypes: [...FORM_FILE_ALLOWED_MIME_TYPES],
    maxBytes: FORM_FILE_MAX_BYTES,
  }),
});

/** One form field — discriminated on `type` over the 8 supported types. */
export const formFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  textareaFieldSchema,
  emailFieldSchema,
  phoneFieldSchema,
  dropdownFieldSchema,
  multiSelectFieldSchema,
  dateFieldSchema,
  fileFieldSchema,
]);

export type FormField = z.infer<typeof formFieldSchema>;

/**
 * The ordered field array persisted as `forms.schema_json`. Field keys must
 * be unique across the form — they key `data_json`, the CSV header, and the
 * webhook `fields` map.
 */
export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1, { message: 'a form needs at least one field' })
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate field key "${field.key}"`,
          path: [index, 'key'],
        });
      }
      seen.add(field.key);
    });
  });

export type FormFields = z.infer<typeof formFieldsSchema>;

/**
 * The form create/update body (POST/PUT /forms/api/forms[/:id]). `status`
 * and `id` are server-managed and deliberately absent.
 */
export const formInputSchema = z.object({
  name: z.string().min(1, { message: 'name is required' }).max(255),
  schema: formFieldsSchema,
  submitLabel: z.string().min(1).max(100).default('Submit'),
  successMessage: z.string().min(1).default('Thank you! Your submission has been received.'),
  spamProtection: z.enum(['recaptcha', 'honeypot']).default('recaptcha'),
  notificationEmail: z
    .string()
    .email({ message: 'notificationEmail must be a valid email' })
    .max(320)
    .optional(),
  webhookUrl: z
    .string()
    .url({ message: 'webhookUrl must be a valid URL' })
    .max(2048)
    .refine((url) => url.startsWith('https://'), {
      message: 'webhookUrl must use https://',
    })
    .optional(),
});

export type FormInput = z.infer<typeof formInputSchema>;
