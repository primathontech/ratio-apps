import { z } from 'zod';

/**
 * Per-merchant Form Builder settings (TRD §5).
 *
 * `recaptchaSecret` is WRITE-ONLY: it may appear in the PUT body (blank or
 * absent = keep the stored value) and is AES-256-GCM encrypted at rest
 * (`forms_configs.recaptcha_secret_enc`). The GET shape never carries it —
 * only the `hasRecaptchaSecret` flag. Both keys are optional because the
 * shared Ratio reCAPTCHA key is the launch default; a merchant sets these
 * only to override with their own key pair.
 */

/** reCAPTCHA v3 score threshold — submissions scoring below it are rejected. */
export const formsRecaptchaThresholdSchema = z
  .number()
  .min(0, { message: 'threshold must be between 0 and 1' })
  .max(1, { message: 'threshold must be between 0 and 1' });

export const formsNotificationEmailSchema = z
  .string()
  .email({ message: 'defaultNotificationEmail must be a valid email' })
  .max(320);

/** The shape the admin Config form PUTs to the backend. */
export const formsConfigInputSchema = z.object({
  recaptchaSiteKey: z.string().max(255).optional(),
  /** Write-only. Blank/absent = keep the stored secret untouched. */
  recaptchaSecret: z.string().max(255).optional(),
  recaptchaThreshold: formsRecaptchaThresholdSchema.default(0.3),
  defaultNotificationEmail: formsNotificationEmailSchema.optional(),
  /** Per-merchant kill switch. */
  formsEnabled: z.boolean().default(true),
});

export type FormsConfigInput = z.infer<typeof formsConfigInputSchema>;

/**
 * The GET shape — same as the input minus the secret, plus the
 * `hasRecaptchaSecret` redaction flag and the `emailBounced` warning flag
 * (set by the email worker when the default recipient bounces).
 */
export const formsConfigSchema = z.object({
  recaptchaSiteKey: z.string().max(255).optional(),
  recaptchaThreshold: formsRecaptchaThresholdSchema,
  defaultNotificationEmail: formsNotificationEmailSchema.optional(),
  formsEnabled: z.boolean(),
  hasRecaptchaSecret: z.boolean(),
  emailBounced: z.boolean().default(false),
});

export type FormsConfig = z.infer<typeof formsConfigSchema>;
