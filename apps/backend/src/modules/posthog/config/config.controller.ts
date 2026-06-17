import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_POSTHOG_EVENT_MAP,
  DEFAULT_POSTHOG_HOSTS,
} from '@ratio-app/shared/constants/posthog-events';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { PostHogConfig } from '@ratio-app/shared/schemas/posthog-config';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { PosthogMerchantTokenGuard } from '../guards';
import { PosthogConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './posthog-config.dto';

@Controller('posthog/api')
export class PosthogConfigController {
  constructor(private readonly config: PosthogConfigService) {}

  /**
   * Defaults the admin pre-fills the form with. Carried from prototype's
   * /api/defaults endpoint — same shape, just under the /posthog prefix.
   */
  @Get('defaults')
  defaults(): {
    eventMap: Record<string, string>;
    events: PostHogConfig['events'];
    hosts: readonly string[];
  } {
    return {
      eventMap: DEFAULT_POSTHOG_EVENT_MAP,
      events: buildDefaultEventMap(),
      hosts: DEFAULT_POSTHOG_HOSTS,
    };
  }

  @Get('posthog-config')
  @UseGuards(PosthogMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<PostHogConfig> {
    return this.config.getByMerchantId(merchant.id);
  }

  @Put('posthog-config')
  @UseGuards(PosthogMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<PostHogConfig> {
    return this.config.upsert(merchant.id, body);
  }
}
