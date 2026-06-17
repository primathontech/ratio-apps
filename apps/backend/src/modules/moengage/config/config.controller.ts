import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_MOENGAGE_EVENT_MAP,
  MOENGAGE_DATA_CENTERS,
} from '@ratio-app/shared/constants/moengage-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { MoEngageConfig } from '@ratio-app/shared/schemas/moengage-config';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { MoengageMerchantTokenGuard } from '../guards';
import { MoengageConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './moengage-config.dto';

/**
 * NOTE: controller path stays at `moengage/api` (NOT `moengage/api/moengage-config`)
 * to preserve the existing public contract:
 *   - GET  /moengage/api/defaults
 *   - GET  /moengage/api/moengage-config
 *   - PUT  /moengage/api/moengage-config
 *
 * The D.11 plan task lists `@Controller('moengage/api/moengage-config')` but
 * following that literally would break `/moengage/api/defaults` and the
 * existing e2e tests + admin SPA. Keep both routes under the shared
 * `moengage/api` prefix.
 */
@Controller('moengage/api')
export class MoengageConfigController {
  constructor(private readonly config: MoengageConfigService) {}

  @Get('defaults')
  defaults(): {
    eventMap: Record<string, string>;
    events: MoEngageConfig['events'];
    dataCenters: typeof MOENGAGE_DATA_CENTERS;
  } {
    return {
      eventMap: DEFAULT_MOENGAGE_EVENT_MAP,
      events: buildDefaultEventMap('moengage'),
      dataCenters: MOENGAGE_DATA_CENTERS,
    };
  }

  @Get('moengage-config')
  @UseGuards(MoengageMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<MoEngageConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('moengage-config')
  @UseGuards(MoengageMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<MoEngageConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
