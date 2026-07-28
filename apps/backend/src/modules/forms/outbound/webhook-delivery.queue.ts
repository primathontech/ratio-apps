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
 */

/** Default queue name when `FORMS_WEBHOOK_QUEUE_URL` is unset (local dev / ElasticMQ). */
export const FORMS_WEBHOOK_QUEUE_DEFAULT = 'forms-webhook-delivery';

/**
 * `core/queue/queue.service.ts` resolves queues by NAME (it calls the
 * idempotent CreateQueue under the hood), while the documented env key
 * (`FORMS_WEBHOOK_QUEUE_URL`, TRD §6) may carry either a bare queue name or
 * a full SQS queue URL from IaC output. Accept both: a URL is reduced to its
 * final path segment (the queue name).
 */
export function queueNameFromEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/')) {
    const last = trimmed.split('/').filter(Boolean).at(-1);
    return last ?? null;
  }
  return trimmed;
}

/** Resolved at call time so tests / worker pods can vary env without reboots. */
export function formsWebhookQueueName(): string {
  return queueNameFromEnv(process.env.FORMS_WEBHOOK_QUEUE_URL) ?? FORMS_WEBHOOK_QUEUE_DEFAULT;
}

/** One webhook delivery attempt: the worker loads the row and executes it. */
export interface WebhookDeliveryMessage {
  deliveryId: number;
}
