import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  type LoyaltyConfig,
  type LoyaltyConfigResponse,
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
  async get(@CurrentMerchant() merchant: Merchant): Promise<LoyaltyConfigResponse> {
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

  /** Reveal the merchant's claim-signing secret — paste into the storefront's server env. */
  @Get('loyalty-config/claim-secret')
  @UseGuards(LoyaltyMerchantTokenGuard)
  async claimSecret(@CurrentMerchant() merchant: Merchant): Promise<{ secret: string }> {
    return this.config.getClaimSecret(merchant.id);
  }

  /** Regenerate + persist a new claim-signing secret for the merchant. */
  @Post('loyalty-config/claim-secret/rotate')
  @UseGuards(LoyaltyMerchantTokenGuard)
  async rotateClaimSecret(@CurrentMerchant() merchant: Merchant): Promise<{ secret: string }> {
    return this.config.rotateClaimSecret(merchant.id);
  }
}
