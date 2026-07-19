import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_DELHIVERY_AWB_TRIGGER,
  DEFAULT_DELHIVERY_BOX_CM,
  DEFAULT_DELHIVERY_PICKUP_CUTOFF,
} from '@ratio-app/shared/constants/delhivery-events';
import type { DelhiveryConfig } from '@ratio-app/shared/schemas/delhivery-config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { ZodType } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import { DelhiveryMerchantTokenGuard } from '../guards';
import { DelhiverySdkService } from '../sdk/sdk.service';
import { DelhiveryConfigService } from './config.service';
import { type UpdateConfigDto, updateConfigDtoSchema } from './delhivery-config.dto';

/** The masked shape the admin sees: the raw token NEVER leaves the backend. */
type MaskedDelhiveryConfig = Omit<DelhiveryConfig, 'apiToken'> & {
  /** `''` when unset, otherwise `••••` + last 4 chars, enough to recognize the key. */
  apiTokenMasked: string;
  hasApiToken: boolean;
};

function maskConfig(config: DelhiveryConfig): MaskedDelhiveryConfig {
  const { apiToken, ...rest } = config;
  return {
    ...rest,
    apiTokenMasked: apiToken ? `••••${apiToken.slice(-4)}` : '',
    hasApiToken: apiToken.length > 0,
  };
}

@Controller('delhivery/api')
export class DelhiveryConfigController {
  constructor(
    private readonly config: DelhiveryConfigService,
    private readonly sdk: DelhiverySdkService,
  ) {}

  /** Defaults the admin pre-fills the Config form with. */
  @Get('defaults')
  defaults(): {
    pickupCutoff: string;
    awbTrigger: 'auto' | 'manual';
    defaultBox: { l: number; b: number; h: number };
  } {
    return {
      pickupCutoff: DEFAULT_DELHIVERY_PICKUP_CUTOFF,
      awbTrigger: DEFAULT_DELHIVERY_AWB_TRIGGER,
      defaultBox: { ...DEFAULT_DELHIVERY_BOX_CM },
    };
  }

  @Get('delhivery-config')
  @UseGuards(DelhiveryMerchantTokenGuard)
  async get(@CurrentMerchant() merchant: Merchant): Promise<MaskedDelhiveryConfig> {
    return maskConfig(await this.config.getByMerchantId(merchant.id));
  }

  /**
   * Persist the config (token encrypted at rest). Saving never talks to
   * Delhivery: warehouse registration is its own explicit action
   * (POST delhivery-config/warehouse), so editing operational settings
   * cannot stall or alarm on a slow or unreachable carrier.
   */
  @Put('delhivery-config')
  @UseGuards(DelhiveryMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<MaskedDelhiveryConfig> {
    return maskConfig(await this.config.upsert(merchant.id, body));
  }

  /**
   * Register the saved pickup location as a Delhivery warehouse. Idempotent:
   * creates the warehouse, or edits it to match the saved pickup details when
   * the name already exists. The carrier outcome (Delhivery's own message,
   * verbatim) is reported, never thrown; the saved config is untouched either way.
   */
  @Post('delhivery-config/warehouse')
  @UseGuards(DelhiveryMerchantTokenGuard)
  async registerWarehouse(@CurrentMerchant() merchant: Merchant): Promise<{
    warehouseStatus: 'created' | 'exists' | 'updated' | 'failed';
    warehouseMessage: string;
  }> {
    // Registration reads the saved pickup details, so a missing config row is
    // a 404 (CONFIG_NOT_FOUND) before any carrier call is attempted.
    await this.config.getByMerchantId(merchant.id);
    const warehouse = await this.sdk.syncWarehouse(merchant.id);
    return { warehouseStatus: warehouse.status, warehouseMessage: warehouse.message };
  }

  /** Validate the stored Delhivery token against the live API. */
  @Post('delhivery-config/test')
  @UseGuards(DelhiveryMerchantTokenGuard)
  async test(@CurrentMerchant() merchant: Merchant): Promise<{ ok: boolean; status: number }> {
    return this.sdk.testConnection(merchant.id);
  }
}
