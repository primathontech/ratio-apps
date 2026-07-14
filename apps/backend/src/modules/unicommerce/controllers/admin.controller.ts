import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { UcAdminTokenGuard } from '../guards';
import { UcCredentialsService } from '../services/credentials.service';
import { UcSyncQueueService } from '../services/sync-queue.service';
import { UcOauthService } from '../services/oauth.service';
import { UcOrderPushService } from '../services/order-push.service';
import { UcCircuitBreakerService } from '../services/circuit-breaker.service';
import { Inject } from '@nestjs/common';
import { UC_MOCK_UNICOMMERCE, UC_MOCK_RATIO } from '../tokens';
import type { MockUnicommerceService } from '../mock/mock-unicommerce.service';
import type { MockRatioOrderService } from '../mock/mock-ratio-order.service';

@Controller('api/uc')
@UseGuards(UcAdminTokenGuard)
export class UcAdminController {
  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly syncQueue: UcSyncQueueService,
    private readonly oauth: UcOauthService,
    private readonly orderPush: UcOrderPushService,
    private readonly circuitBreaker: UcCircuitBreakerService,
    @Inject(UC_MOCK_UNICOMMERCE) private readonly ucMock: MockUnicommerceService,
    @Inject(UC_MOCK_RATIO) private readonly ratioMock: MockRatioOrderService,
  ) {}

  @Post('test-connection')
  async testConnection(
    @Body() body: { tenantSlug: string; username: string; password: string },
  ): Promise<unknown> {
    try {
      const token = await this.ucMock.exchangeToken(body.tenantSlug, body.username, body.password);
      const facilities = await this.ucMock.getFacilities(body.tenantSlug, token.access_token);
      return { success: true, facilities: facilities.facilities };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  @Post('activate')
  async activate(@Body() body: {
    merchantId: string;
    tenantSlug: string;
    username: string;
    password: string;
    facilityCode: string;
  }): Promise<unknown> {
    await this.credentials.save({
      merchantId: body.merchantId,
      tenantSlug: body.tenantSlug,
      username: body.username,
      password: body.password,
      facilityCode: body.facilityCode,
    });

    await this.oauth.obtainToken(body.merchantId);
    await this.circuitBreaker.reset(body.merchantId);

    return { success: true, message: 'Unicommerce integration activated' };
  }

  @Get('sync-status/:merchantId')
  async syncStatus(@Param('merchantId') merchantId: string): Promise<unknown> {
    const creds = await this.credentials.getPublic(merchantId);
    const failedItems = await this.syncQueue.getFailedItems(merchantId);
    const tripped = await this.circuitBreaker.isTripped(merchantId);

    return {
      connected: !!creds,
      active: creds?.active ?? false,
      killSwitch: creds?.killSwitch ?? false,
      tenantSlug: creds?.tenantSlug ?? null,
      facilityCode: creds?.facilityCode ?? null,
      circuitBreakerTripped: tripped,
      failedItems: failedItems.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        syncType: item.syncType,
        lastError: item.lastError,
        retryCount: item.retryCount,
        updatedAt: item.updatedAt,
      })),
    };
  }

  @Post('retry/:itemId')
  async retry(@Param('itemId') itemId: string): Promise<unknown> {
    await this.syncQueue.retry(itemId);
    return { success: true, message: 'Retry scheduled' };
  }

  @Post('pause/:merchantId')
  async pause(@Param('merchantId') merchantId: string): Promise<unknown> {
    await this.credentials.setKillSwitch(merchantId, true);
    return { success: true, message: 'Sync paused' };
  }

  @Post('resume/:merchantId')
  async resume(@Param('merchantId') merchantId: string): Promise<unknown> {
    await this.credentials.setKillSwitch(merchantId, false);
    await this.circuitBreaker.reset(merchantId);
    return { success: true, message: 'Sync resumed' };
  }

  @Post('disconnect/:merchantId')
  async disconnect(@Param('merchantId') merchantId: string): Promise<unknown> {
    await this.credentials.delete(merchantId);
    return { success: true, message: 'Disconnected' };
  }

  @Get('pre-check/:merchantId')
  async preCheck(@Param('merchantId') merchantId: string): Promise<unknown> {
    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds) return { success: false, error: 'Merchant not configured' };

    const token = await this.oauth.getValidToken(merchantId);
    const topSkus = await this.ratioMock.getTopSkus(merchantId, 20);
    const skuResults = await this.ucMock.checkSkusExist(creds.tenantSlug, token, topSkus);

    const notFound = Object.entries(skuResults).filter(([, exists]) => !exists).map(([sku]) => sku);

    return {
      success: true,
      totalSkusChecked: topSkus.length,
      notFoundInUc: notFound,
      warning: notFound.length > 0
        ? `${notFound.length} SKU(s) not found in Unicommerce. Orders with these SKUs will fail.`
        : null,
    };
  }
}
