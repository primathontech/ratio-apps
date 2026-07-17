/**
 * Delhivery Direct — shipment status model + app-side shipping events.
 *
 * Delhivery is a CARRIER app (not analytics): instead of an OpenStore→vendor
 * pixel event map, this file declares the unified shipment status set the
 * module tracks, the KwikEngage shipping-event names fired app-side per status
 * transition (the 7 shipping events are not in the platform event catalog),
 * and the config defaults used to seed a fresh install.
 */

/** Unified (Ratio-side) shipment statuses — the module's `delhivery_shipments.status`. */
export const DELHIVERY_SHIPMENT_STATUSES = [
  'awaiting_pickup',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'delivery_failed',
  'rto_completed',
  'shipment_cancelled',
] as const;

export type DelhiveryShipmentStatus = (typeof DELHIVERY_SHIPMENT_STATUSES)[number];

/**
 * KwikEngage shipping-event name fired app-side on each unified-status
 * transition. Deduped per StatusType transition — one event per (awb, status).
 */
export const KWIKENGAGE_EVENT_BY_STATUS = {
  awaiting_pickup: 'shipment_created',
  in_transit: 'shipment_in_transit',
  out_for_delivery: 'shipment_out_for_delivery',
  delivered: 'shipment_delivered',
  delivery_failed: 'shipment_delivery_failed',
  rto_completed: 'shipment_rto_completed',
  shipment_cancelled: 'shipment_cancelled',
} as const satisfies Record<DelhiveryShipmentStatus, string>;

/** Statuses that still need tracking polls (non-terminal). */
export const DELHIVERY_IN_FLIGHT_STATUSES = [
  'awaiting_pickup',
  'in_transit',
  'out_for_delivery',
  'delivery_failed',
] as const satisfies readonly DelhiveryShipmentStatus[];

/** Config defaults used to seed a fresh install / pre-fill the admin form. */
export const DEFAULT_DELHIVERY_PICKUP_CUTOFF = '10:00';
export const DEFAULT_DELHIVERY_AWB_TRIGGER = 'auto' as const;
export const DEFAULT_DELHIVERY_BOX_CM = { l: 10, b: 10, h: 10 } as const;

/** The carrier code written on every shipment row / mirrored to the order. */
export const DELHIVERY_CARRIER = 'DELHIVERY';
