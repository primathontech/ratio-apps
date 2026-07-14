import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UC_MOCK_UNICOMMERCE, UC_MOCK_RATIO } from '../tokens';
import type { MockUnicommerceService } from '../mock/mock-unicommerce.service';
import type { MockRatioOrderService } from '../mock/mock-ratio-order.service';
import { UcOauthService } from './oauth.service';
import { UcCredentialsService } from './credentials.service';
import { UcCircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class UcFulfillmentPollService {
  private readonly logger = new Logger(UcFulfillmentPollService.name);
  private running = false;

  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly oauth: UcOauthService,
    private readonly circuitBreaker: UcCircuitBreakerService,
    @Inject(UC_MOCK_UNICOMMERCE) private readonly ucMock: MockUnicommerceService,
    @Inject(UC_MOCK_RATIO) private readonly ratioMock: MockRatioOrderService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async pollAllMerchants(): Promise<void> {
    if (this.running) {
      this.logger.warn('fulfillment poll already running, skipping');
      return;
    }
    this.running = true;
    try {
      const merchants = await this.credentials.getAllActiveMerchants();
      this.logger.log({ msg: 'fulfillment poll starting', merchantCount: merchants.length });
      for (const merchant of merchants) {
        await this.pollMerchant(merchant.merchantId);
      }
    } finally {
      this.running = false;
    }
  }

  async pollMerchant(merchantId: string): Promise<number> {
    const tripped = await this.circuitBreaker.isTripped(merchantId);
    if (tripped) {
      this.logger.warn({ msg: 'circuit breaker tripped, skipping fulfillment poll', merchantId });
      return 0;
    }

    try {
      const creds = await this.credentials.getDecrypted(merchantId);
      if (!creds) return 0;

      const token = await this.oauth.getValidToken(merchantId);
      const response = await this.ucMock.searchShippingPackages(creds.tenantSlug, token, 35);
      let updatedCount = 0;

      for (const pkg of response.shippingPackages) {
        const order = await this.ratioMock.searchOrders({ search: pkg.saleOrderCode });
        if (order.orders.length === 0) continue;

        const ratioOrder = order.orders[0];
        if (!ratioOrder) continue;
        if (pkg.status === 'DISPATCHED' || pkg.status === 'SHIPPED') {
          const update: Record<string, string> = { status: 'shipped' };
          if (pkg.trackingNumber) update.tracking_number = pkg.trackingNumber;
          if (pkg.courierName) update.logistics_partner = pkg.courierName;
          if (pkg.trackingNumber) update.awb_number = pkg.trackingNumber;
          await this.ratioMock.updateOrder(ratioOrder.id, update as never);
          updatedCount++;
          this.logger.log({ msg: 'order marked shipped', merchantId, orderId: ratioOrder.id, tracking: pkg.trackingNumber });
        } else if (pkg.status === 'DELIVERED') {
          await this.ratioMock.updateOrder(ratioOrder.id, { status: 'delivered' });
          updatedCount++;
        } else if (pkg.status === 'CANCELLED') {
          await this.ratioMock.updateOrder(ratioOrder.id, { status: 'cancelled' });
          updatedCount++;
        }
      }

      this.logger.log({ msg: 'fulfillment poll complete', merchantId, updatedCount });
      return updatedCount;
    } catch (err) {
      await this.circuitBreaker.recordFailure(merchantId);
      this.logger.error({ msg: 'fulfillment poll failed', merchantId, error: err instanceof Error ? err.message : String(err) });
      return 0;
    }
  }
}
