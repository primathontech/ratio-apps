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
import { type UpdateConfigDto, updateConfigDtoSchema } from './delhivery-config.dto';
import { DelhiveryConfigService } from './config.service';

/** The masked shape the admin sees — the raw token NEVER leaves the backend. */
type MaskedDelhiveryConfig = Omit<DelhiveryConfig, 'apiToken'> & {
  /** `''` when unset, otherwise `••••` + last 4 chars — enough to recognize the key. */
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
   * Save the config (token encrypted at rest) and best-effort register the
   * pickup location as a Delhivery warehouse. Warehouse registration must not
   * fail the save — the warehouse usually already exists on Delhivery's side
   * (their API rejects duplicates), so its result is reported, not thrown.
   */
  @Put('delhivery-config')
  @UseGuards(DelhiveryMerchantTokenGuard)
  async update(
    @CurrentMerchant() merchant: Merchant,
    @Body(new ZodValidationPipe(updateConfigDtoSchema as unknown as ZodType<UpdateConfigDto>))
    body: UpdateConfigDto,
  ): Promise<
    MaskedDelhiveryConfig & {
      warehouseRegistered: boolean;
      warehouseStatus: 'created' | 'exists' | 'updated' | 'failed';
      /** Delhivery's own message for the outcome — surfaced verbatim, not hardcoded. */
      warehouseMessage: string;
    }
  > {
    const saved = await this.config.upsert(merchant.id, body);
    // syncWarehouse creates the warehouse (or, if the name already exists, edits it
    // to match the saved pickup details) — idempotent and self-healing across saves.
    const warehouse = await this.sdk.syncWarehouse(merchant.id);
    return {
      ...maskConfig(saved),
      warehouseRegistered: warehouse.ok,
      warehouseStatus: warehouse.status,
      warehouseMessage: warehouse.message,
    };
  }

  /** Validate the stored Delhivery token against the live API. */
  @Post('delhivery-config/test')
  @UseGuards(DelhiveryMerchantTokenGuard)
  async test(@CurrentMerchant() merchant: Merchant): Promise<{ ok: boolean; status: number }> {
    return this.sdk.testConnection(merchant.id);
  }
}
