import { Controller, Get, Header, Inject, NotFoundException, Query } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import type { DelhiveryDatabase } from '../db/types';
import {
  DelhiveryServiceabilityService,
  type ServiceabilityResult,
} from '../serviceability/serviceability.service';
import { DELHIVERY_MERCHANTS } from '../tokens';

const serviceabilityQuerySchema = z.object({
  merchantId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'pincode must be a 6-digit Indian PIN'),
  // Accepted for forward-compat with the GoKwik Checkout contract; unused in v1.
  order_value: z.coerce.number().nonnegative().optional(),
  cod: z.enum(['true', 'false']).optional(),
});
type ServiceabilityQuery = z.infer<typeof serviceabilityQuerySchema>;

/**
 * Checkout-facing serviceability endpoint (TRD §2). PUBLIC — GoKwik Checkout
 * calls it during address entry, so there is no merchant-token guard; the
 * caller identifies the store via `merchantId`. The merchant's Delhivery
 * token never leaves the backend — this route only returns the boolean
 * serviceability verdict + EDD band (6h cached, fail-open).
 */
@Controller('delhivery/api')
export class DelhiverySdkController {
  constructor(
    private readonly serviceability: DelhiveryServiceabilityService,
    @Inject(DELHIVERY_MERCHANTS) private readonly merchants: MerchantsService<DelhiveryDatabase>,
  ) {}

  @Get('serviceability')
  @Header('Access-Control-Allow-Origin', '*')
  async check(
    @Query(new ZodValidationPipe(serviceabilityQuerySchema as unknown as ZodType<ServiceabilityQuery>))
    query: ServiceabilityQuery,
  ): Promise<ServiceabilityResult> {
    const merchant = await this.merchants.findById(query.merchantId);
    if (!merchant?.isActive) {
      throw new NotFoundException({
        message: 'merchant not installed or uninstalled',
        error_code: 'MERCHANT_INACTIVE',
      });
    }
    return this.serviceability.check(query.merchantId, query.pincode);
  }
}
