import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  adsConversionIdSchema,
  ga4MeasurementIdSchema,
  gmcMerchantIdSchema,
  type GoogleConfig,
  type GoogleDiscoverResponse,
} from '@ratio-app/shared/schemas/google-config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { DiscoveryService } from '../discovery/discovery.service';
import { GmcValidationService } from '../gmc/gmc-validation.service';
import { GoogleMerchantTokenGuard } from '../guards';
import { type UpdateConfigDto, updateConfigDtoSchema } from './google-config.dto';
import { GoogleConfigService } from './config.service';

/** Static options the admin form pre-fills its selects with. */
const TARGET_COUNTRIES = ['IN', 'US', 'GB', 'AE', 'SG', 'AU', 'CA'] as const;
const LANGUAGES = ['en', 'hi'] as const;
const CURRENCIES = ['INR', 'USD', 'GBP', 'AED', 'SGD', 'AUD', 'CAD'] as const;
const CONDITIONS = ['new', 'refurbished', 'used'] as const;

@Controller('google/api')
export class GoogleConfigController {
  constructor(
    private readonly config: GoogleConfigService,
    private readonly gmcValidation: GmcValidationService,
    private readonly discovery: DiscoveryService,
  ) {}

  /** Options the admin form pre-fills its dropdowns with. */
  @Get('defaults')
  defaults() {
    return {
      targetCountries: TARGET_COUNTRIES,
      languages: LANGUAGES,
      currencies: CURRENCIES,
      conditions: CONDITIONS,
    };
  }

  @Get('google-config')
  @UseGuards(GoogleMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<GoogleConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Get('discover')
  @UseGuards(GoogleMerchantTokenGuard)
  async discover(@CurrentMerchant() merchant: Merchant): Promise<GoogleDiscoverResponse> {
    return this.discovery.discover(merchant.id);
  }

  @Put('google-config')
  @UseGuards(GoogleMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<GoogleConfig> {
    return this.config.upsert(merchant.id, body);
  }

  @Post('validate-ga4')
  @UseGuards(GoogleMerchantTokenGuard)
  validateGa4(@Body('measurementId') measurementId: string): { ok: boolean } {
    return { ok: ga4MeasurementIdSchema.safeParse(measurementId).success };
  }

  @Post('validate-ads')
  @UseGuards(GoogleMerchantTokenGuard)
  validateAds(
    @Body('conversionId') conversionId: string,
    @Body('conversionLabel') conversionLabel: string,
  ): { ok: boolean } {
    const idOk = adsConversionIdSchema.safeParse(conversionId).success;
    const labelOk = typeof conversionLabel === 'string' && conversionLabel.length > 0;
    return { ok: idOk && labelOk };
  }

  @Post('validate-gmc')
  @UseGuards(GoogleMerchantTokenGuard)
  async validateGmc(
    @Body('merchantId') gmcMerchantId: string,
    @Body('key') key: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!gmcMerchantIdSchema.safeParse(gmcMerchantId).success) {
      return { ok: false, error: 'Merchant ID must be numeric' };
    }
    return this.gmcValidation.validate(key, gmcMerchantId);
  }
}
