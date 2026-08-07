import { Injectable } from '@nestjs/common';
import { UcOrderItemMapService } from './order-item-map.service';
import { UcStatusMappingService } from './status-mapping.service';
import { UcRatioApiService } from './uc-ratio-api.service';

// The per-item payload the standalone `uc-inbound-ingest` app stores on a
// `status_notify` job row (migration 0003): exactly the fields from UC's
// `orderItems[]` element plus the route's `:orderId`, kept for event-log
// reference. `merchantId` is NOT in here — it lives on the job row.
export interface StatusNotifyPayload {
  orderId: string;
  orderItemId: string;
  status: string;
  IsReverse: boolean;
  updated: string;
}

export interface StatusNotifyResult {
  applied: boolean;
  reason?: 'no_change';
  mappedStatus?: string;
}

/**
 * Async per-item equivalent of `UcStatusController.notify()`'s per-item
 * loop (status.controller.ts) — the worker the inbound consumer dispatches
 * `status_notify` jobs to. Mirrors that logic exactly, minus what the
 * synchronous endpoint needs and this path doesn't:
 *
 * - no feature-flag gate (the ingest path never consulted it; jobs are only
 *   ever created by the new app, and the flag check is the sync endpoint's
 *   concern — noted as an open question in the ingest work, not silently
 *   re-implemented here);
 * - no per-item response accumulation: the queue decides success/failure from
 *   the worker throwing (recoverable → retry ladder, non-recoverable → DLQ)
 *   or returning.
 *
 * Failure vocabulary is IDENTICAL to the sync endpoint's per-item
 * `errorMessage` values so `UcInboundQueueService.isNonRecoverable()` can
 * classify them the same way ops already reads them: 'unknown orderItemId'
 * and 'unrecognized status' are terminal (DLQ); a thrown Ratio API error is
 * recoverable (retried).
 */
@Injectable()
export class UcStatusNotifyWorkerService {
  constructor(
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly statusMapping: UcStatusMappingService,
    private readonly ratio: UcRatioApiService,
  ) {}

  async apply(merchantId: string, payload: StatusNotifyPayload): Promise<StatusNotifyResult> {
    const full = await this.orderItemMap.resolveFull(payload.orderItemId);
    if (!full || full.merchantId !== merchantId) {
      throw new Error('unknown orderItemId');
    }

    // Duplicate/out-of-order short-circuit — identical condition to the sync
    // endpoint's `no_change` per-item error, but a legitimate "nothing to do"
    // outcome here (the job itself was processed successfully).
    if (full.lastStatusUpdatedAt) {
      const incoming = new Date(payload.updated).getTime();
      const stored = new Date(full.lastStatusUpdatedAt).getTime();
      if (incoming <= stored && full.lastStatus === payload.status) {
        return { applied: false, reason: 'no_change' };
      }
    }

    // Throws `unrecognized Unicommerce status: ...` for unknown statuses —
    // same exception `UcStatusController` catches to emit its per-item
    // 'unrecognized status'. Non-recoverable by classification.
    const mapped = this.statusMapping.map(payload.status, payload.IsReverse);

    // Same as the sync endpoint: a 'no_change' mapping (e.g. CREATED/PICKED)
    // means no Ratio write, but `updateLastStatus` still records the latest
    // UC status so the duplicate short-circuit above keeps working.
    if (mapped !== 'no_change') {
      await this.ratio.updateOrderStatus(merchantId, full.ratioOrderId, mapped);
    }
    await this.orderItemMap.updateLastStatus(payload.orderItemId, payload.status, payload.updated);

    return { applied: true, mappedStatus: mapped };
  }
}
