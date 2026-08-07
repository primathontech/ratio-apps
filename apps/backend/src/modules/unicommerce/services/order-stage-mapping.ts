/**
 * Single source of truth for order "stage" classification and per-stage
 * idle thresholds, used by the reconciliation/alert job (§ pending TRD
 * update) to flag an order that hasn't advanced within its expected window.
 *
 * `classifyRatioOrder` mirrors the mapping already inline in
 * `orders-read.controller.ts`'s `mapToUcFormat` (Ratio's own `status`/
 * `fulfillment_status` → the UC-facing orderStatus taxonomy) — kept here as
 * the one place this classification lives; that controller should read from
 * here rather than keeping its own copy, to avoid the two drifting apart.
 *
 * `STAGE_IDLE_THRESHOLD_DAYS` values are this project's own defaults, NOT
 * confirmed Unicommerce/Ratio SLAs — CREATED's 3 days was given directly;
 * DISPATCHED and RETURN_REQUESTED are placeholders pending real merchant
 * fulfillment-time data. Tune once that's available.
 */

export type OrderStage =
  | 'CREATED'
  | 'DISPATCHED'
  | 'RETURN_REQUESTED'
  | 'DELIVERED'
  | 'COURIER_RETURN'
  | 'CANCELLED';

export function classifyRatioOrder(order: {
  status?: string;
  fulfillment_status?: string;
}): OrderStage {
  if (order.status === 'cancelled') return 'CANCELLED';
  const fs = order.fulfillment_status ?? 'unfulfilled';
  if (fs === 'fulfilled' || fs === 'partially_fulfilled') return 'DISPATCHED';
  if (fs === 'delivered') return 'DELIVERED';
  if (fs === 'return_in_progress' || fs === 'return_pickup_scheduled') return 'RETURN_REQUESTED';
  if (fs === 'returned' || fs === 'restocked' || fs === 'return_failed') return 'COURIER_RETURN';
  return 'CREATED';
}

// Stages with no next transition to wait for — never flagged as idle.
const TERMINAL_STAGES = new Set<OrderStage>(['DELIVERED', 'COURIER_RETURN', 'CANCELLED']);

export function isTerminalStage(stage: OrderStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

// Days allowed in a non-terminal stage before the reconciliation/alert job
// flags it as idle. `null` = terminal, never flagged.
export const STAGE_IDLE_THRESHOLD_DAYS: Record<OrderStage, number | null> = {
  CREATED: 3,
  DISPATCHED: 5,
  RETURN_REQUESTED: 5,
  DELIVERED: null,
  COURIER_RETURN: null,
  CANCELLED: null,
};

export function isIdle(stage: OrderStage, stageEnteredAt: Date, now: Date): boolean {
  const thresholdDays = STAGE_IDLE_THRESHOLD_DAYS[stage];
  if (thresholdDays === null) return false;
  const idleDays = (now.getTime() - stageEnteredAt.getTime()) / (24 * 60 * 60 * 1000);
  return idleDays > thresholdDays;
}

// UC's own status vocabulary (status-mapping.service.ts's FORWARD_MAP/
// REVERSE_MAP keys) grouped into the same stage buckets, so a future job
// that only has UC's raw status string (not yet resolved against Ratio's
// order) can classify without re-deriving this list.
export const UC_STATUS_TO_STAGE: Record<string, OrderStage> = {
  CREATED: 'CREATED',
  LOCATION_NOT_SERVICEABLE: 'CREATED',
  PICKING: 'CREATED',
  PICKED: 'CREATED',
  PENDING_CUSTOMIZATION: 'CREATED',
  CUSTOMIZATION_COMPLETE: 'CREATED',
  PACKED: 'CREATED',
  READY_TO_SHIP: 'CREATED',
  SPLITTED: 'CREATED',
  MERGED: 'CREATED',
  MANIFESTED: 'CREATED',
  DISPATCHED: 'DISPATCHED',
  SHIPPED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  RETURN_EXPECTED: 'RETURN_REQUESTED',
  RETURN_ACKNOWLEDGED: 'RETURN_REQUESTED',
  RETURNED: 'COURIER_RETURN',
  // Reverse-flow-only values (status-mapping.service.ts's REVERSE_MAP)
  COURIER_ALLOCATED: 'RETURN_REQUESTED',
  COMPLETE: 'COURIER_RETURN',
  NOT_RECEIVED: 'COURIER_RETURN',
};
