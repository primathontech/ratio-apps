import { Body, Controller, Get, Logger, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { MetaConfigService } from '../config/config.service';
import { MetaMerchantTokenGuard } from '../guards';
import { CatalogService } from './catalog.service';

interface CatalogConfigBody {
  catalogId?: string;
  catalogAccessToken?: string;
  syncEnabled?: boolean;
}

/**
 * Admin catalog endpoints (behind the merchant-token guard).
 *  GET  /meta/api/v1/catalog/config — current catalog settings (no token)
 *  PUT  /meta/api/v1/catalog/config — save catalog id/token/sync; auto-fires the
 *                                     first full sync when sync is turned ON
 *  POST /meta/api/v1/catalog/sync   — manual "Sync Now" (background stream)
 *  GET  /meta/api/v1/catalog/status — recent sync runs for the dashboard
 */
@Controller('meta/api/v1/catalog')
@UseGuards(MetaMerchantTokenGuard)
export class MetaCatalogController {
  private readonly logger = new Logger(MetaCatalogController.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly config: MetaConfigService,
  ) {}

  @Get('config')
  config_(@CurrentMerchant() merchant: Merchant) {
    return this.config.getCatalogAdminView(merchant.id);
  }

  @Put('config')
  async saveConfig(@CurrentMerchant() merchant: Merchant, @Body() body: CatalogConfigBody) {
    const saved = await this.config.upsertCatalogConfig(merchant.id, body);
    // Sync just turned ON → kick off the initial full sync automatically.
    if (saved.flippedOn) {
      this.logger.log({ msg: 'catalog sync enabled — starting initial full sync', merchantId: merchant.id });
      this.catalog.startFullSyncInBackground(merchant.id, 'initial');
    }
    return {
      catalogId: saved.catalogId,
      syncEnabled: saved.syncEnabled,
      feedToken: saved.feedToken,
      initialSyncStarted: saved.flippedOn,
    };
  }

  @Post('sync')
  sync(@CurrentMerchant() merchant: Merchant, @Query('force') force?: string): { started: boolean; force: boolean } {
    const forceAll = force === 'true' || force === '1';
    this.catalog.startFullSyncInBackground(merchant.id, forceAll ? 'manual-force' : 'manual', forceAll);
    return { started: true, force: forceAll };
  }

  @Post('sync/stop')
  stopSync(@CurrentMerchant() merchant: Merchant): { stopping: boolean } {
    return this.catalog.requestStop(merchant.id);
  }

  @Get('status')
  async status(@CurrentMerchant() merchant: Merchant): Promise<{ runs: unknown[] }> {
    return { runs: await this.catalog.getStatus(merchant.id) };
  }
}
