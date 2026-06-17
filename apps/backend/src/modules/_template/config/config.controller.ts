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
import { TemplateMerchantTokenGuard } from '../guards';
import { type UpdateConfigDto, updateConfigDtoSchema } from './_template-config.dto';
import { TemplateConfigService } from './config.service';

@Controller('_template/api')
export class TemplateConfigController {
  constructor(private readonly config: TemplateConfigService) {}

  /**
   * Defaults the admin pre-fills the form with. Carried from prototype's
   * /api/defaults endpoint — same shape, just under the /_template prefix.
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

  @Get('_template-config')
  @UseGuards(TemplateMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<TemplateConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('_template-config')
  @UseGuards(TemplateMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<TemplateConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
