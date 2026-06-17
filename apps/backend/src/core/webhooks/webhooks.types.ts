import type { Transaction } from 'kysely';
import { z } from 'zod';
import type { DatabaseWithMerchants } from '../merchants/merchant.types';
import type { DatabaseWithWebhookLog } from './webhook-log.types';

export const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Hard cap on the JSON payload size we'll accept on a webhook delivery.
 * 64 KB is comfortably above any realistic upstream event but far below
 * MySQL's `max_allowed_packet` (default 64MB) and process memory pressure.
 * Bumping this should be a conscious decision — anything bigger probably
 * belongs in object storage with a reference URL in the event body.
 */
export const WEBHOOK_MAX_PAYLOAD_BYTES = 64 * 1024;

export const webhookEnvelopeSchema = z.object({
  // `id` is stored in `webhook_log.ratio_webhook_id` (VARCHAR(255)) — cap to
  // match the column so an over-long id is rejected with a 400 at validation
  // time instead of throwing a MySQL truncation 500 deep inside dispatch().
  id: z.string().min(1).max(255),
  // `event` is stored in `webhook_log.topic` (VARCHAR(128)) — same reasoning
  // as `id`. Bound to the column width to keep validation aligned with the
  // schema.
  event: z.string().min(1).max(128),
  timestamp: z.coerce.date(),
  merchantId: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/**
 * Webhook handler contract.
 *
 * `handle()` receives the open transaction that `WebhooksService.dispatch()`
 * is running in. Any DB writes the handler performs MUST go through `trx`
 * (not a module-level Kysely handle) so that they roll back atomically with
 * the `webhook_log` row if anything downstream throws. This is what makes
 * the dispatch self-healing: a crash mid-handler leaves no `webhook_log`
 * row, so Ratio's next retry runs the handler again from scratch.
 */
export interface WebhookHandler {
  readonly topic: string;
  handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void>;
}
