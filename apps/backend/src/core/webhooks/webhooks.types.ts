import { createHash } from 'node:crypto';
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

function productVersion(product: Record<string, unknown>): string | null {
  const updatedAt = product.updated_at ?? product.updatedAt;
  if (typeof updatedAt === 'string' && updatedAt) return updatedAt;
  if (typeof updatedAt === 'number') return String(updatedAt);
  try {
    return createHash('sha256').update(JSON.stringify(product)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Derive the FALLBACK dedupe key for an envelope. Used only when no
 * per-delivery `x-webhook-id` header is present on the inbound request.
 *
 * Product events key on `<event_type>:<product.id>:<version>` where `version`
 * changes per real update (see {@link productVersion}) — so a genuine
 * re-update is processed immediately and only an identical re-delivery is
 * suppressed. Events with no product (e.g. `app/uninstalled`) collapse to
 * `<event_type>:none`. Stored in `webhook_log.ratio_webhook_id` (VARCHAR(255)).
 *
 * When the platform DOES supply a per-delivery id, `dispatch()` uses that as
 * the exact dedup key instead.
 */
export function deriveWebhookId(e: WebhookEnvelope): string {
  const rid = (e.product && typeof e.product.id === 'string' && e.product.id) || 'none';
  if (rid === 'none') return `${e.event_type}:none`;
  const version = productVersion(e.product as Record<string, unknown>);
  return version ? `${e.event_type}:${rid}:${version}` : `${e.event_type}:${rid}`;
}

/**
 * The dedupe key for an inbound delivery.
 *
 * ⚠️ The platform's `x-webhook-id` is NOT unique per delivery — it REPEATS
 * across genuine re-updates of the same product (verified live: two distinct
 * `products/update` deliveries carried the identical id). Keying dedupe on the
 * id alone therefore suppressed every real re-update for the whole 3h window.
 * So we BIND the id to a content fingerprint of the payload:
 *   - true retry  (same id + byte-identical body) → same key → suppressed ✓
 *   - real update (same id + changed body)         → new key  → processed ✓
 *
 * When there is NO delivery id, fall back to {@link deriveWebhookId} (which
 * carries its own per-update discriminator).
 */
export function dedupeKey(deliveryId: string | undefined, e: WebhookEnvelope): string {
  const trimmed = typeof deliveryId === 'string' ? deliveryId.trim() : '';
  if (trimmed === '') return deriveWebhookId(e);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(e.product ?? {}))
    .digest('hex')
    .slice(0, 16);
  return `${trimmed}:${fingerprint}`;
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
