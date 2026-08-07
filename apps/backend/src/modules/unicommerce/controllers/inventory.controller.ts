import { Body, Controller, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RawResponse } from '../../../core/common/decorators/raw-response.decorator';
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

@ApiTags('unicommerce')
@Controller('unicommerce/api/v1')
@UseGuards(UcApiKeyGuard)
@RawResponse()
export class UcInventoryController {
  private readonly logger = new Logger(UcInventoryController.name);

  constructor(
    private readonly inventory: UcInventoryService,
    private readonly eventLog: UcEventLogService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  @Post('updateInventory')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update variant inventory',
    description:
      'Called BY Unicommerce per facility, on stock change. One call per facility per SKU (UC never pre-aggregates). ' +
      '`variantId` is OUR OWN Ratio variant id (the same `variantId` returned by GET /products) — no SKU resolution ' +
      'is performed. Each item upserts a facility-level row, then the SUM across every known facility row for that ' +
      'variant is written to Ratio. A single failing item does not abort the batch — it lands in `failedProductList` ' +
      'and the top-level `status` reflects the worst case (PARTIAL_SUCCESS/FAILED).',
  })
  @ApiHeader({
    name: 'apikey',
    required: true,
    description: 'Access token issued by /authToken (TTL ~48h). Identifies the merchant.',
    example: 'pX7vK2mQ9nL4wR8tY5bH1cJ3dF6gS0zA7eU2iM4k',
  })
  @ApiBody({
    required: true,
    description:
      'Per-facility inventory deltas. `inventory` is sent by UC as a STRING (e.g. `"24"`), per UC\'s contract.',
    schema: {
      type: 'object',
      properties: {
        inventoryList: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              productId: {
                type: 'string',
                example: 'gid://shopify/Product/8123456789012',
                description: 'Our own Ratio product id.',
              },
              variantId: {
                type: 'string',
                example: 'gid://shopify/Variant/4345678901234',
                description: 'Our own Ratio variant id (the one returned by GET /products).',
              },
              inventory: {
                type: 'string',
                example: '24',
                description: 'Quantity for this facility (string, as UC sends it).',
              },
              hsnCode: {
                type: 'string',
                example: '6109',
                description: 'Optional HSN code; logged only.',
              },
              facilityCode: {
                type: 'string',
                example: 'DEL-BLR-01',
                description: 'Optional facility code. Absent → sentinel `_default` facility.',
              },
            },
            required: ['productId', 'variantId', 'inventory'],
          },
        },
      },
      required: ['inventoryList'],
    },
  })
  @ApiResponse({
    status: 200,
    description:
      '`status` is SUCCESS when every item applied, PARTIAL_SUCCESS when some failed, FAILED when all failed. ' +
      'Failures carry the productId + message in `failedProductList`; a disabled sync flag returns `{ status: "SUCCESS", failedProductList: [] }` (accept-and-no-op).',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS'] },
        failedProductList: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string', example: 'gid://shopify/Product/8123456789012' },
              message: { type: 'string', example: 'Ratio inventory update failed' },
            },
            required: ['productId', 'message'],
          },
        },
      },
      required: ['status', 'failedProductList'],
      example: {
        status: 'SUCCESS',
        failedProductList: [],
      },
    },
  })
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
