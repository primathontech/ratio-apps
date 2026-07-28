import { queueNameFromEnv } from './webhook-delivery.queue';

/**
 * SQS plumbing for the forms email-notification pipeline — same
 * DB-is-the-scheduler shape as `webhook-delivery.queue.ts`: the sweeper
 * claims due `form_email_log` rows and enqueues `{ emailLogId }`; the worker
 * sends via SES and writes the outcome back to the row.
 */

/** Default queue name when `FORMS_EMAIL_QUEUE_URL` is unset (local dev / ElasticMQ). */
export const FORMS_EMAIL_QUEUE_DEFAULT = 'forms-email-notification';

/** Resolved at call time so tests / worker pods can vary env without reboots. */
export function formsEmailQueueName(): string {
  return queueNameFromEnv(process.env.FORMS_EMAIL_QUEUE_URL) ?? FORMS_EMAIL_QUEUE_DEFAULT;
}

/** One email send attempt: the worker loads the log row and executes it. */
export interface EmailNotificationMessage {
  emailLogId: number;
}
