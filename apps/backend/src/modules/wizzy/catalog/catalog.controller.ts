import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { WizzyMerchantTokenGuard } from '../guards';
import { CatalogQueryService } from './catalog-query.service';
import { CatalogSyncService } from './catalog-sync.service';

/** Merchant-guarded catalog-health + force-sync endpoints for the admin. */
@Controller('wizzy/api/catalog')
@UseGuards(WizzyMerchantTokenGuard)
export class CatalogController {
  constructor(
    private readonly query: CatalogQueryService,
    private readonly sync: CatalogSyncService,
  ) {}

  @Get('summary')
  async summary(@CurrentMerchant() merchant: Merchant) {
    const summary = await this.query.summary(merchant.id);
    // `syncing` lets the admin keep the Force Sync button disabled + poll until done.
    return { ...summary, syncing: this.sync.isSyncing(merchant.id) };
  }

  @Get('items')
  items(
    @CurrentMerchant() merchant: Merchant,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStatus = status && this.query.isValidStatus(status) ? status : undefined;
    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.query.items(merchant.id, {
      ...(parsedStatus ? { status: parsedStatus } : {}),
      page: parsedPage,
      limit: parsedLimit,
    });
  }

  @Get('history')
  history(@CurrentMerchant() merchant: Merchant) {
    return this.query.history(merchant.id);
  }

  @Post('sync')
  @HttpCode(201)
  async forceSync(@CurrentMerchant() merchant: Merchant): Promise<{ started: boolean }> {
    // Reject a duplicate trigger while a sync is already running for this merchant.
    // (The service guard is the real lock; this gives the button immediate feedback.)
    if (this.sync.isSyncing(merchant.id)) {
      return { started: false };
    }
    // Fire-and-forget: a full catalog sync can take a while. The in-memory lock is
    // claimed synchronously inside fullSync, so a rapid second click sees started:false.
    void this.sync.forceSync(merchant.id).catch(() => undefined);
    return { started: true };
  }
}
