import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { LoyaltyMerchantTokenGuard } from '../guards';
import { StatsService } from './stats.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 3600 * 1000;
/** Default window: the last 30 days (inclusive of today). */
const DEFAULT_RANGE_DAYS = 30;

interface DateRange {
  from: string;
  to: string;
}

function resolveRange(from?: string, to?: string): DateRange {
  for (const value of [from, to]) {
    if (value !== undefined && !DATE_RE.test(value)) {
      throw new BadRequestException({
        message: 'from/to must be YYYY-MM-DD',
        error_code: 'INVALID_DATE_RANGE',
      });
    }
  }
  const toStr = to ?? new Date().toISOString().slice(0, 10);
  const fromStr =
    from ??
    new Date(Date.parse(`${toStr}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS)
      .toISOString()
      .slice(0, 10);
  if (fromStr > toStr) {
    throw new BadRequestException({
      message: 'from must not be after to',
      error_code: 'INVALID_DATE_RANGE',
    });
  }
  return { from: fromStr, to: toStr };
}

/** Merchant dashboard reads (PRD §4.5 full scope) over the daily snapshots. */
@Controller('loyalty/api/dashboard')
@UseGuards(LoyaltyMerchantTokenGuard)
export class LoyaltyDashboardController {
  constructor(private readonly stats: StatsService) {}

  @Get('summary')
  summary(
    @CurrentMerchant() merchant: Merchant,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = resolveRange(from, to);
    return this.stats.summary(merchant.id, range.from, range.to);
  }

  @Get('trend')
  trend(
    @CurrentMerchant() merchant: Merchant,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = resolveRange(from, to);
    return this.stats.trend(merchant.id, range.from, range.to);
  }

  @Get('rules')
  rules(@CurrentMerchant() merchant: Merchant) {
    return this.stats.rulesTable(merchant.id);
  }

  @Get('qr')
  qr(@CurrentMerchant() merchant: Merchant) {
    return this.stats.qrTable(merchant.id);
  }

  @Get('bulk')
  bulk(
    @CurrentMerchant() merchant: Merchant,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = resolveRange(from, to);
    return this.stats.bulkSummary(merchant.id, range.from, range.to);
  }
}
