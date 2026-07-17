import type { Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

/**
 * Per-merchant carrier config. `api_token_enc` holds the merchant's Delhivery
 * Express B2C token encrypted at rest (AES-256-GCM via the module Crypto) —
 * plaintext never touches the DB.
 */
interface DelhiveryConfigsTable {
  merchantId: string;
  apiTokenEnc: string;
  pickupLocationName: Generated<string>;
  /** Pickup warehouse pincode — Delhivery warehouse `pin` + Expected-TAT `origin_pin`. */
  pickupPincode: Generated<string>;
  pickupPhone: Generated<string>;
  pickupAddress: Generated<string>;
  pickupCity: Generated<string>;
  gstin: Generated<string>;
  /** Daily manifest cutoff, `HH:mm` IST. */
  pickupCutoff: Generated<string>;
  awbTrigger: Generated<'auto' | 'manual'>;
  defaultBoxLCm: Generated<number>;
  defaultBoxBCm: Generated<number>;
  defaultBoxHCm: Generated<number>;
  enabled: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/**
 * The module-owned shipment record — the SOURCE OF TRUTH for AWB/tracking
 * (no Ratio Fulfillment Service). A summary is mirrored to the platform order.
 * `order_number` is UNIQUE per merchant (Delhivery `order` idempotency key);
 * an orders/edited recreate UPDATES the row in place (new AWB) — the status
 * history lives in `delhivery_tracking_events`.
 */
interface DelhiveryShipmentsTable {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  awb: Generated<string | null>;
  carrier: Generated<string>;
  status: string;
  paymentMode: 'COD' | 'Prepaid';
  codAmount: Generated<number>;
  weightGrams: Generated<number>;
  labelUrl: Generated<string | null>;
  estimatedDelivery: Generated<Date | null>;
  active: Generated<boolean>;
  /** Stamped when a pickup/manifest request covering this shipment was filed. */
  pickupRequestedAt: Generated<Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Tracking audit + dedupe — UNIQUE `(awb, unified_status)` per transition. */
interface DelhiveryTrackingEventsTable {
  id: string;
  awb: string;
  rawStatus: string;
  unifiedStatus: string;
  location: Generated<string | null>;
  eventTs: Generated<Date | null>;
  createdAt: Generated<Date>;
}

export interface DelhiveryDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  delhivery_configs: DelhiveryConfigsTable;
  delhivery_shipments: DelhiveryShipmentsTable;
  delhivery_tracking_events: DelhiveryTrackingEventsTable;
}

export type DelhiveryMerchantRow = Selectable<BaseMerchantsTable>;
export type DelhiveryConfigRow = Selectable<DelhiveryConfigsTable>;
export type DelhiveryShipmentRow = Selectable<DelhiveryShipmentsTable>;
export type DelhiveryTrackingEventRow = Selectable<DelhiveryTrackingEventsTable>;
