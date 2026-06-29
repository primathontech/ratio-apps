import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { WizzyConfig } from '@ratio-app/shared/schemas/wizzy-config';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { WizzyApiClient } from '../catalog/wizzy-api.client';
import { WizzyMerchantTokenGuard } from '../guards';
import { WizzyConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './wizzy-config.dto';

@Controller('wizzy/api')
export class WizzyConfigController {
  constructor(
    private readonly config: WizzyConfigService,
    private readonly wizzyClient: WizzyApiClient,
  ) {}

  @Get('wizzy-config')
  @UseGuards(WizzyMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<WizzyConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('wizzy-config')
  @UseGuards(WizzyMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<WizzyConfig> {
    return this.config.upsert(merchant.id, body);
  }

  /**
   * Test-connection endpoint. Validates that the entered Store ID + Store Secret
   * + API Key work against the Wizzy API. Credentials come directly from the
   * request body (not from the DB) so the merchant can test before saving.
   */
  @Post('validate-wizzy')
  @UseGuards(WizzyMerchantTokenGuard)
  @HttpCode(200)
  async validateWizzy(
    @Body('storeId') storeId: string,
    @Body('storeSecret') storeSecret: string,
    @Body('apiKey') apiKey: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!storeId || !storeSecret || !apiKey) {
      return { ok: false, error: 'storeId, storeSecret, and apiKey are required' };
    }
    return this.wizzyClient.testConnection(storeId, storeSecret, apiKey);
  }
}
