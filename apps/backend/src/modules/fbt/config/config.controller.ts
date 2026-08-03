import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_TEMPLATE_EVENT_MAP,
  DEFAULT_TEMPLATE_HOSTS,
} from '@ratio-app/shared/constants/_template-events';
import type { TemplateConfig } from '@ratio-app/shared/schemas/_template-config';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { FbtMerchantTokenGuard } from '../guards';
import { type UpdateConfigDto, updateConfigDtoSchema } from './fbt-config.dto';
import { FbtConfigService } from './config.service';

@Controller('fbt/api')
export class FbtConfigController {
  constructor(private readonly config: FbtConfigService) {}

  /**
   * Defaults the admin pre-fills the form with. Carried from prototype's
   * /api/defaults endpoint — same shape, just under the /fbt prefix.
   */
  @Get('defaults')
  defaults(): {
    eventMap: Record<string, string>;
    events: TemplateConfig['events'];
    hosts: readonly string[];
  } {
    return {
      eventMap: DEFAULT_TEMPLATE_EVENT_MAP,
      events: buildDefaultEventMap(),
      hosts: DEFAULT_TEMPLATE_HOSTS,
    };
  }

  @Get('fbt-config')
  @UseGuards(FbtMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<TemplateConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('fbt-config')
  @UseGuards(FbtMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<TemplateConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
