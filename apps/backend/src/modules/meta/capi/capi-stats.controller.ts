import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { MetaMerchantTokenGuard } from '../guards';
import { CapiStatsService, type StatsSummary } from './capi-stats.service';

/**
 * Admin analytics for CAPI delivery (behind the merchant-token guard).
 *   GET /meta/api/v1/capi/stats?days=30
 * Returns the per-day timeline + derived totals and success rate. Separate from
 * the browser-facing ingest controller so the guard only covers this read.
 */
@Controller('meta/api/v1/capi')
@UseGuards(MetaMerchantTokenGuard)
export class MetaCapiStatsController {
  constructor(private readonly stats: CapiStatsService) {}

  @Get('stats')
  summary(
    @CurrentMerchant() merchant: Merchant,
    @Query('days') days?: string,
  ): Promise<StatsSummary> {
    const n = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.stats.getSummary(merchant.id, n);
  }
}
