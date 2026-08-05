import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  type FbtMerchantConfigInput,
  fbtMerchantConfigSchema,
} from '@ratio-app/shared/schemas/fbt-config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { FbtMerchantTokenGuard } from '../guards';
import { type FbtConfigOutput, FbtConfigService } from './config.service';

/** Per-merchant recommendation settings for the admin's Recommendations screen. */
@Controller('fbt/api/config')
@UseGuards(FbtMerchantTokenGuard)
export class FbtConfigController {
  constructor(private readonly config: FbtConfigService) {}

  @Get()
  get(@CurrentMerchant() merchant: Merchant): Promise<FbtConfigOutput> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put()
  update(
    @CurrentMerchant() merchant: Merchant,
    @Body(
      new ZodValidationPipe(fbtMerchantConfigSchema as unknown as ZodType<FbtMerchantConfigInput>),
    )
    body: FbtMerchantConfigInput,
  ): Promise<FbtConfigOutput> {
    return this.config.upsert(merchant.id, body);
  }
}
