import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  CLEVERTAP_REGIONS,
  DEFAULT_CLEVERTAP_EVENT_MAP,
} from '@ratio-app/shared/constants/clevertap-events';
import type { ClevertapConfigOutput } from '@ratio-app/shared/schemas/clevertap-config';
import { buildDefaultEventMap, type EventMap } from '@ratio-app/shared/schemas/event-map';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { ClevertapMerchantTokenGuard } from '../guards';
import { type CatalogSyncResult, ClevertapCatalogSyncService } from '../sync/catalog-sync.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './clevertap-config.dto';
import {
  ClevertapConfigService,
  type ClevertapDeliveryHealth,
  type ClevertapStatus,
} from './config.service';

@Controller('clevertap/api')
export class ClevertapConfigController {
  constructor(
    private readonly config: ClevertapConfigService,
    private readonly catalogSync: ClevertapCatalogSyncService,
  ) {}

  @Get('defaults')
  defaults(): {
    eventMap: Record<string, string>;
    events: EventMap;
    regions: typeof CLEVERTAP_REGIONS;
  } {
    return {
      eventMap: DEFAULT_CLEVERTAP_EVENT_MAP,
      events: buildDefaultEventMap('clevertap'),
      regions: CLEVERTAP_REGIONS,
    };
  }

  @Get('clevertap-config')
  @UseGuards(ClevertapMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<ClevertapConfigOutput> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('clevertap-config')
  @UseGuards(ClevertapMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<ClevertapConfigOutput> {
    return this.config.upsert(merchant.id, body);
  }

  @Get('status')
  @UseGuards(ClevertapMerchantTokenGuard)
  async status(@CurrentMerchant() merchant: Merchant): Promise<ClevertapStatus> {
    return this.config.getStatus(merchant.id);
  }

  @Get('status/deliveries')
  @UseGuards(ClevertapMerchantTokenGuard)
  async deliveries(@CurrentMerchant() merchant: Merchant): Promise<ClevertapDeliveryHealth> {
    return this.config.getDeliveryHealth(merchant.id);
  }

  @Post('catalog/sync')
  @UseGuards(ClevertapMerchantTokenGuard)
  async syncCatalog(@CurrentMerchant() merchant: Merchant): Promise<CatalogSyncResult> {
    return this.catalogSync.syncMerchant(merchant.id);
  }
}
