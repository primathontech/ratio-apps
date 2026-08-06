import { Body, Controller, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { UcApiKeyGuard } from '../guards';
import { UcEventLogService } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcInventoryService } from '../services/inventory.service';

const updateInventorySchema = z.object({
  inventoryList: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string(),
      inventory: z.string(),
      hsnCode: z.string().optional(),
      facilityCode: z.string().optional(),
    }),
  ),
});

@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
export class UcInventoryController {
  private readonly logger = new Logger(UcInventoryController.name);

  constructor(
    private readonly inventory: UcInventoryService,
    private readonly eventLog: UcEventLogService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  @Post('updateInventory')
  @HttpCode(200)
  async update(
    @Req() req: FastifyRequest & { ucMerchantId: string },
    @Body(new ZodValidationPipe(updateInventorySchema)) body: z.infer<typeof updateInventorySchema>,
  ) {
    // TRD §6: accept-and-no-op when disabled — never hard-reject.
    if (!(await this.featureFlags.isEnabled('inventory_sync', req.ucMerchantId))) {
      return { status: 'SUCCESS' as const, failedProductList: [] };
    }
    const result = await this.inventory.apply(req.ucMerchantId, body.inventoryList);
    // Fix 2: an event-log write failure must never turn this real result
    // into a 500 for Unicommerce — log-and-swallow instead of letting it
    // reject the handler.
    try {
      await this.eventLog.record({
        merchantId: req.ucMerchantId,
        direction: 'inbound',
        flow: 'inventory',
        reference: body.inventoryList.map((i) => i.variantId).join(','),
        result:
          result.status === 'SUCCESS'
            ? 'success'
            : result.status === 'FAILED'
              ? 'failed'
              : 'partial',
        payload: body,
        response: result,
      });
    } catch (err) {
      this.logger.error({
        msg: 'event-log write failed for updateInventory',
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return result;
  }
}
