/**
 * Durable SQS plumbing for the async CSV export pipeline (webhook-delivery
 * precedent: name constants live in the module that owns the queue;
 * `core/queue/queue.service.ts` accepts any string name).
 *
 * The `form_export_jobs` row is the state; SQS is only the hand-off between
 * the merchant-guarded POST (which inserts a `pending` row and enqueues its
 * id) and the worker (which streams the CSV into S3 and writes the outcome
 * back to the row). A message carries nothing but the job id.
 *
 * The documented env key (`FORMS_EXPORT_QUEUE_URL`) may carry either a bare
 * queue name or a full SQS URL from IaC output; `queueNameFromEnv` (shared with
 * the other forms queues) reduces a URL to its final path segment.
 */
import { queueNameFromEnv } from '../../../core/queue/queue-name';

/** Default queue name when `FORMS_EXPORT_QUEUE_URL` is unset (local dev / ElasticMQ). */
export const FORMS_EXPORT_QUEUE_DEFAULT = 'forms-export';

/** Resolved at call time so tests / worker pods can vary env without reboots. */
export function formsExportQueueName(): string {
  return queueNameFromEnv(process.env.FORMS_EXPORT_QUEUE_URL) ?? FORMS_EXPORT_QUEUE_DEFAULT;
}

/** One export job: the worker loads the row and streams it into S3. */
export interface ExportJobMessage {
  jobId: string;
}
