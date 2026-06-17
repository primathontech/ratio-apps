import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  DATA_SHARING_LEVELS,
  DEFAULT_META_EVENT_MAP,
  PRODUCT_ID_TYPES,
} from '@ratio-app/shared/constants/meta-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { MetaConfig } from '@ratio-app/shared/schemas/meta-config';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { MetaMerchantTokenGuard } from '../guards';
import { MetaConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './meta-config.dto';

@Controller('meta/api')
export class MetaConfigController {
  constructor(private readonly config: MetaConfigService) {}

  /**
   * Defaults the admin pre-fills the form with. Carried from prototype's
   * /api/defaults endpoint — same shape, just under the /meta prefix.
   */
  @Get('defaults')
  defaults(): {
    eventMap: Record<string, string>;
    events: MetaConfig['events'];
    dataSharingLevels: readonly string[];
    productIdTypes: readonly string[];
  } {
    return {
      eventMap: DEFAULT_META_EVENT_MAP,
      events: buildDefaultEventMap(),
      dataSharingLevels: DATA_SHARING_LEVELS,
      productIdTypes: PRODUCT_ID_TYPES,
    };
  }

  @Get('meta-config')
  @UseGuards(MetaMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<MetaConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('meta-config')
  @UseGuards(MetaMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<MetaConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
