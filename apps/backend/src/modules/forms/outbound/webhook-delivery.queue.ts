/**
 * Durable SQS queue plumbing for the forms webhook-delivery pipeline
 * (google-product-sync precedent: name constants live in the module that
 * owns the queue; `core/queue/queue.service.ts` accepts any string name).
 *
 * The DB is the SCHEDULER (TRD §1): `form_webhook_deliveries.next_retry_at`
 * decides WHEN; the minute sweeper claims due rows and enqueues one message
 * per row; the worker performs the attempt and writes the outcome back to
 * the row. SQS is only the hand-off between sweeper and worker — a message
 * carries nothing but the row id.
 *
 * The documented env key (`FORMS_WEBHOOK_QUEUE_URL`, TRD §6) may carry either a
 * bare queue name or a full SQS queue URL; `queueNameFromEnv` (shared with the
 * other forms queues) reduces a URL to its final path segment.
 */
import { queueNameFromEnv } from '../../../core/queue/queue-name';

/** Default queue name when `FORMS_WEBHOOK_QUEUE_URL` is unset (local dev / ElasticMQ). */
export const FORMS_WEBHOOK_QUEUE_DEFAULT = 'forms-webhook-delivery';

/** Resolved at call time so tests / worker pods can vary env without reboots. */
export function formsWebhookQueueName(): string {
  return queueNameFromEnv(process.env.FORMS_WEBHOOK_QUEUE_URL) ?? FORMS_WEBHOOK_QUEUE_DEFAULT;
}

/** One webhook delivery attempt: the worker loads the row and executes it. */
export interface WebhookDeliveryMessage {
  deliveryId: number;
}
