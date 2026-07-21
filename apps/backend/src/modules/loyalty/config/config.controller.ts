import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  type LoyaltyConfig,
  loyaltyConfigInputSchema,
} from '@ratio-app/shared/schemas/loyalty-config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { LoyaltyMerchantTokenGuard } from '../guards';
import { LoyaltyConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './loyalty-config.dto';

@Controller('loyalty/api')
export class LoyaltyConfigController {
  constructor(private readonly config: LoyaltyConfigService) {}

  /** Defaults the admin pre-fills the Settings form with (public). */
  @Get('defaults')
  defaults(): LoyaltyConfig {
    return loyaltyConfigInputSchema.parse({});
  }

  @Get('loyalty-config')
  @UseGuards(LoyaltyMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<LoyaltyConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('loyalty-config')
  @UseGuards(LoyaltyMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<LoyaltyConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
