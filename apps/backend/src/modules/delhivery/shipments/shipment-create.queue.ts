/** Durable SQS queue names for the Delhivery shipment pipeline. */
export const DELHIVERY_QUEUE_NAMES = {
  shipments: 'delhivery-shipment-create',
  dlq: 'delhivery-shipment-create-dlq',
} as const;

/**
 * A unit of shipment work enqueued by the orders/* webhook handlers. The
 * worker fetches the authoritative order by id — messages carry references
 * only, mirroring the google product-sync queue.
 *
 *   - `create`   — orders/paid → manifestation → AWB (auto-trigger mode).
 *   - `cancel`   — orders/cancelled → cancel the AWB pre-pickup / mark.
 *   - `recreate` — orders/edited pre-pickup → cancel + re-manifest.
 */
export type DelhiveryShipmentMessage = {
  op: 'create' | 'cancel' | 'recreate';
  merchantId: string;
  orderId: string;
  orderNumber?: string;
};
