import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { FeedItemStatus } from '@ratio-app/shared/schemas/google-config';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { GoogleMerchantTokenGuard } from '../guards';
import { FeedSyncService } from './feed-sync.service';
import { FeedQueryService } from './feed-query.service';

const VALID_STATUSES: FeedItemStatus[] = ['SYNCED', 'PENDING', 'ERROR', 'WARNING', 'DELETED'];

/** Merchant-guarded feed-health + force-sync endpoints for the admin. */
@Controller('google/api/feed')
@UseGuards(GoogleMerchantTokenGuard)
export class GoogleFeedController {
  constructor(
    private readonly query: FeedQueryService,
    private readonly sync: FeedSyncService,
  ) {}

  @Get('summary')
  summary(@CurrentMerchant() merchant: Merchant) {
    return this.query.summary(merchant.id);
  }

  @Get('items')
  items(
    @CurrentMerchant() merchant: Merchant,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStatus = VALID_STATUSES.includes(status as FeedItemStatus)
      ? (status as FeedItemStatus)
      : undefined;
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

  @Get('events')
  events(
    @CurrentMerchant() merchant: Merchant,
    @Query('offerId') offerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    return this.query.events(merchant.id, {
      ...(offerId ? { offerId } : {}),
      page: parsedPage,
      limit: parsedLimit,
    });
  }

  @Post('sync')
  async forceSync(@CurrentMerchant() merchant: Merchant): Promise<{ started: true }> {
    // Fire-and-forget: a full catalog sync can take a while; the admin polls the
    // summary/history endpoints for progress rather than blocking on this call.
    void this.sync.forceSync(merchant.id).catch(() => undefined);
    return { started: true };
  }
}
