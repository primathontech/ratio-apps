import { z } from 'zod';

/**
 * The Form Builder's OUTBOUND webhook contract (`form.submitted`) plus the
 * delivery retry/queue constants shared by the backend workers and the admin
 * (TRD §5). This is the app's own webhook to merchant endpoints (e.g. a
 * KwikEngage inbound URL) — not a Ratio platform webhook.
 */

export const FORM_SUBMITTED_EVENT = 'form.submitted';

/** Bump on any breaking change to the payload shape (documented contract). */
export const FORM_SUBMITTED_SCHEMA_VERSION = '1.0';

/**
 * The documented `form.submitted` payload (PRD AC10). Field values are the
 * submitted answers keyed by field key; file fields carry 7-day signed URLs.
 */
export const formSubmittedPayloadSchema = z.object({
  event: z.literal(FORM_SUBMITTED_EVENT),
  merchant_id: z.string().min(1),
  form_id: z.string().min(1),
  form_name: z.string(),
  /** ISO-8601 UTC timestamp of the submission. */
  submitted_at: z.iso.datetime(),
  submission_id: z.string().min(1),
  schema_version: z.literal(FORM_SUBMITTED_SCHEMA_VERSION),
  fields: z.record(z.string(), z.unknown()),
});

export type FormSubmittedPayload = z.infer<typeof formSubmittedPayloadSchema>;

/**
 * Non-2xx delivery retry schedule: 5m, 20m, 1h after the Nth failure
 * (index = attempts already made - 1). SQS DelaySeconds caps at 15 min, so
 * the DB row's `next_retry_at` + the sweeper cron are the scheduler (TRD §1).
 */
export const FORMS_WEBHOOK_RETRY_DELAYS_MS = [5 * 60_000, 20 * 60_000, 60 * 60_000] as const;

/** After this many failed attempts a delivery is `failed` (manual re-trigger only). */
export const FORMS_WEBHOOK_MAX_ATTEMPTS = 3;

/** Email notifications retry exactly once, 10 minutes after the first failure. */
export const FORMS_EMAIL_RETRY_DELAY_MS = 10 * 60_000;
