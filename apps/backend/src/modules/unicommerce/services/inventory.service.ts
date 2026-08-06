import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UcRatioApiService } from './uc-ratio-api.service';

interface InventoryUpdateItem {
  productId: string;
  variantId: string;
  inventory: string;
  hsnCode?: string | undefined;
  facilityCode?: string | undefined;
  sku?: string | undefined;
}

export interface ApplyResult {
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL_SUCCESS';
  failedProductList: { productId: string; message: string }[];
}

@Injectable()
export class UcInventoryService {
  constructor(
    private readonly ratio: UcRatioApiService,
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
  ) { }

  async apply(merchantId: string, items: InventoryUpdateItem[]): Promise<ApplyResult> {
    const failed: { productId: string; message: string }[] = [];

    for (const item of items) {
      // Confirmed (TRD v2 redesign): UC sends `variantId` as OUR OWN Ratio
      // variant_id directly — the same id we returned via GET /products.
      // No SKU-cache resolution is needed or correct here; treating it as a
      // SKU to look up (the earlier design) meant every real inventory
      // update failed with "not found," since the SKU-keyed cache was never
      // populated with this value at all.
      const ratioVariantId = item.variantId;
      const qty = Number(item.inventory);

      try {
        const facilityCode = item.facilityCode || '_default';
        await this.handle.db
          .insertInto('ucVariantInventory')
          .values({
            merchantId,
            variantId: ratioVariantId,
            facilityCode,
            sku: item.sku ?? item.variantId,
            inventory: qty,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            inventory: qty,
            sku: item.sku ?? item.variantId,
            updatedAt: new Date(),
          })
          .execute();

        const aggregation = await this.handle.db
          .selectFrom('ucVariantInventory')
          .select(this.handle.db.fn.sum<number>('inventory').as('total'))
          .where('merchantId', '=', merchantId)
          .where('variantId', '=', ratioVariantId)
          .executeTakeFirst();
        const totalQty = Number(aggregation?.total ?? qty);
        await this.ratio.updateVariantInventory(merchantId, ratioVariantId, totalQty);
      } catch (err) {
        // Without a local cache pre-check, a real failure (e.g. Ratio has no
        // variant with this id) can only be detected by the Ratio call
        // itself failing — caught here so one bad item doesn't abort the
        // whole batch.
        failed.push({
          productId: item.productId,
          message: err instanceof Error ? err.message : 'Ratio inventory update failed',
        });
      }
    }

    if (failed.length === 0) return { status: 'SUCCESS', failedProductList: [] };
    return { status: 'PARTIAL_SUCCESS', failedProductList: failed };
  }
}
