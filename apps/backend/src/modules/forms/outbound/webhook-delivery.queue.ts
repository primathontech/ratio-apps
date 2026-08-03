/** SQS hand-off for the webhook-delivery pipeline (DB is the scheduler, TRD §1): a message carries only the row id; `FORMS_WEBHOOK_QUEUE_URL` (TRD §6) may be a bare name or full URL. */
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
