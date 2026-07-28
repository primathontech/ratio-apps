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
 * Non-2xx delivery retry schedule: 5m then 20m (indexed by attempts already
 * made). SQS DelaySeconds caps at 15 min, so the DB row's `next_retry_at` + the
 * sweeper cron are the scheduler (TRD §1). One retry per entry, so
 * MAX_ATTEMPTS below is derived as `length + 1` (initial attempt + N retries) —
 * they can never drift, which is what let the old 1h step become unreachable.
 */
export const FORMS_WEBHOOK_RETRY_DELAYS_MS = [5 * 60_000, 20 * 60_000] as const;

/**
 * After this many failed attempts a delivery is `failed` (manual re-trigger
 * only). Derived from the ladder (initial attempt + one retry per delay) so a
 * delay can never be advertised without being reachable.
 */
export const FORMS_WEBHOOK_MAX_ATTEMPTS = FORMS_WEBHOOK_RETRY_DELAYS_MS.length + 1;

/** Email notifications retry exactly once, 10 minutes after the first failure. */
export const FORMS_EMAIL_RETRY_DELAY_MS = 10 * 60_000;
