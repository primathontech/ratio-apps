import { Injectable } from '@nestjs/common';
import { UcInventoryService } from './inventory.service';

// The per-item payload the standalone `uc-inbound-ingest` app stores on an
// `inventory_update` job row (migration 0003): the exact `inventoryList[]`
// element from UC's updateInventory call. `merchantId` lives on the job row,
// not here.
export interface InventoryUpdatePayload {
  productId: string;
  variantId: string;
  inventory: string;
  hsnCode?: string;
  facilityCode?: string;
}

/**
 * Async per-item equivalent of `UcInventoryController.update()`'s work — the
 * worker the inbound consumer dispatches `inventory_update` jobs to. It just
 * delegates to the EXISTING `UcInventoryService.apply()` (no reimplementation)
 * with a single-item list, and translates `apply()`'s per-item
 * `failedProductList` entry back into a thrown error so the queue's existing
 * recoverable/non-recoverable classification decides whether to retry or DLQ.
 *
 * `apply()` never throws per item (it catches and collects into
 * `failedProductList`), so the ONLY way this worker surfaces a failure is by
 * rethrowing that collected message — which is exactly what makes the retry
 * ladder reachable for a transient Ratio/network error while letting a
 * genuinely bad item (e.g. a Ratio 404 with a matching message) classify as
 * non-recoverable and go to the DLQ.
 */
@Injectable()
export class UcInventoryUpdateWorkerService {
  constructor(private readonly inventory: UcInventoryService) {}

  async apply(
    merchantId: string,
    payload: InventoryUpdatePayload,
  ): Promise<ReturnType<UcInventoryService['apply']>> {
    const result = await this.inventory.apply(merchantId, [payload]);
    if (result.failedProductList.length > 0) {
      // `||` not `??`: an empty message must fall back to the generic one so
      // the queue's regex classification sees something meaningful and treats
      // the item as conservatively recoverable (retry) rather than DLQing on a
      // blank line.
      throw new Error(result.failedProductList[0]?.message || 'Ratio inventory update failed');
    }
    return result;
  }
}
