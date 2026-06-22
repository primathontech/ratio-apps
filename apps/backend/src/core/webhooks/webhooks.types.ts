import type { Transaction } from 'kysely';
import { z } from 'zod';
import type { DatabaseWithMerchants } from '../merchants/merchant.types';
import type { DatabaseWithWebhookLog } from './webhook-log.types';

/**
 * Hard cap on the JSON payload size we'll accept on a webhook delivery.
 * 64 KB is comfortably above any realistic upstream event but far below
 * MySQL's `max_allowed_packet` (default 64MB) and process memory pressure.
 * Bumping this should be a conscious decision — anything bigger probably
 * belongs in object storage with a reference URL in the event body.
 */
export const WEBHOOK_MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Retry-windowed dedupe window — FALLBACK only, used when no per-delivery
 * `x-webhook-id` header is present on the inbound request.
 *
 * When a delivery arrives without a per-delivery id, dedupe falls back to
 * `deriveWebhookId(envelope)` = `<event_type>:<product.id|none>`. The
 * platform retries a failed/unacked delivery for roughly 2 hours, so a
 * second delivery of the SAME derived key inside this window is almost
 * certainly a retry and is suppressed. A delivery of the same key OUTSIDE
 * the window is treated as a legitimately new event (e.g. a real second
 * update to the same product) and re-runs the (idempotent) handler.
 */
export const WEBHOOK_DEDUPE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Real inbound webhook envelope per the OpenStore contract. There is NO
 * top-level delivery id and NO timestamp — deliveries look like:
 *   { event_type: "products/create", merchant_id: "...", product: { id, ... } }
 * `.passthrough()` keeps any extra top-level fields the platform may add.
 */
export const webhookEnvelopeSchema = z
  .object({
    event_type: z.string().min(1).max(128),
    merchant_id: z.string().min(1).nullable().optional(),
    product: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/**
 * Derive the FALLBACK dedupe key for an envelope. Used only when no
 * per-delivery `x-webhook-id` header is present on the inbound request.
 *
 * Keys on `event_type` + the product id (when present). Events with no
 * product (e.g. `app/uninstalled`) collapse to `<event_type>:none`.
 * Stored in `webhook_log.ratio_webhook_id` (VARCHAR(255)).
 *
 * When the platform does supply a per-delivery id, `dispatch()` uses that
 * as the exact dedup key instead — so every distinct delivery (including a
 * real second update to the same product) processes independently, and only
 * a true retry of the same delivery id is suppressed.
 */
export function deriveWebhookId(e: WebhookEnvelope): string {
  const rid = (e.product && typeof e.product.id === 'string' && e.product.id) || 'none';
  return `${e.event_type}:${rid}`;
}

/**
 * Webhook handler contract.
 *
 * `handle()` receives the open transaction that `WebhooksService.dispatch()`
 * is running in. Any DB writes the handler performs MUST go through `trx`
 * (not a module-level Kysely handle) so that they roll back atomically with
 * the `webhook_log` row if anything downstream throws. This is what makes
 * the dispatch self-healing: a crash mid-handler leaves no `webhook_log`
 * row, so Ratio's next retry runs the handler again from scratch.
 *
 * `data` now carries the envelope's `product` object.
 */
export interface WebhookHandler {
  readonly topic: string;
  handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void>;
}
