/** SQS plumbing for the async CSV export pipeline: the `form_export_jobs` row is the state and a message carries only the job id. `FORMS_EXPORT_QUEUE_URL` may be a bare name or a full SQS URL; `queueNameFromEnv` reduces a URL to its final path segment. */
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
