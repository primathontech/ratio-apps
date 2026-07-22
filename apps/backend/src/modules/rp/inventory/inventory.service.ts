import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpIdMappingService } from '../id-mapping/id-mapping.service';

@Injectable()
export class RpInventoryService {
  private readonly logger = new Logger(`RP:${RpInventoryService.name}`);

  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly idMapping: RpIdMappingService,
  ) {}

  /**
   * Shopify's `inventory_levels/adjust` takes a DELTA (`available_adjustment`); OS's own
   * inventory endpoint sets an ABSOLUTE quantity. Read the variant's current quantity, add
   * the delta, then write the result back — same read-then-write shape as any other
   * delta-over-absolute adapter. `inventory_item_id` here is the hashed id transformer.service
   * put on the variant (same value as `variant.id`), since OS has no separate inventory-item
   * entity; resolve it back to the real OS variant id the same way products/orders do.
   */
  async adjustInventoryLevel(merchantId: string, body: unknown): Promise<unknown> {
    const { location_id, inventory_item_id, available_adjustment } = (body ?? {}) as Record<string, unknown>;
    if (inventory_item_id == null) {
      throw new BadRequestException('inventory_item_id is required');
    }
    const delta = Number(available_adjustment ?? 0);
    const hashedId = String(inventory_item_id);
    const realVariantId = (await this.idMapping.resolveRealId('variant', hashedId)) ?? hashedId;

    const variant = await this.ratioClient.getVariant(merchantId, realVariantId);
    const current = Number(variant?.inventory_quantity ?? (variant?.inventory as Record<string, unknown> | undefined)?.quantity ?? 0);
    const next = current + delta;

    this.logger.log(
      { merchantId, hashedId, realVariantId, current, delta, next },
      'adjusting OS variant inventory',
    );
    await this.ratioClient.setVariantInventory(merchantId, realVariantId, next);

    return {
      inventory_level: {
        inventory_item_id: Number(inventory_item_id) || inventory_item_id,
        location_id: location_id ?? null,
        available: next,
      },
    };
  }
}
