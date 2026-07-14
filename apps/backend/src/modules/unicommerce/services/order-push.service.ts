import { Inject, Injectable, Logger } from '@nestjs/common';
import { UC_MOCK_UNICOMMERCE, UC_MOCK_RATIO } from '../tokens';
import type { MockUnicommerceService } from '../mock/mock-unicommerce.service';
import type { MockRatioOrderService, RatioOrder } from '../mock/mock-ratio-order.service';
import { UcOauthService } from './oauth.service';
import { UcSyncQueueService } from './sync-queue.service';
import { UcCircuitBreakerService } from './circuit-breaker.service';
import { UcCredentialsService } from './credentials.service';

@Injectable()
export class UcOrderPushService {
  private readonly logger = new Logger(UcOrderPushService.name);

  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly oauth: UcOauthService,
    private readonly syncQueue: UcSyncQueueService,
    private readonly circuitBreaker: UcCircuitBreakerService,
    @Inject(UC_MOCK_UNICOMMERCE) private readonly ucMock: MockUnicommerceService,
    @Inject(UC_MOCK_RATIO) private readonly ratioMock: MockRatioOrderService,
  ) {}

  async pushOrder(merchantId: string, orderId: string): Promise<string | null> {
    const tripped = await this.circuitBreaker.isTripped(merchantId);
    if (tripped) {
      this.logger.warn({ msg: 'circuit breaker tripped, skipping push', merchantId, orderId });
      return null;
    }

    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds || !creds.active || creds.killSwitch) {
      this.logger.warn({ msg: 'merchant not active, skipping push', merchantId, orderId });
      return null;
    }

    const order = await this.ratioMock.getOrder(orderId);
    if (!order) {
      this.logger.error({ msg: 'order not found in Ratio', merchantId, orderId });
      return null;
    }

    return this.pushOrderToUc(merchantId, order, creds.facilityCode);
  }

  async pushOrderFromWebhook(merchantId: string, payload: Record<string, unknown>): Promise<string | null> {
    const tripped = await this.circuitBreaker.isTripped(merchantId);
    if (tripped) return null;

    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds || !creds.active || creds.killSwitch) return null;

    const order = this.ratioMock.createOrderFromWebhook(payload);
    return this.pushOrderToUc(merchantId, order, creds.facilityCode);
  }

  private async pushOrderToUc(merchantId: string, order: RatioOrder, facilityCode: string): Promise<string | null> {
    const token = await this.oauth.getValidToken(merchantId);
    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds) return null;

    const saleOrderItems = order.line_items.map((li) => ({
      itemSku: li.sku,
      unitPrice: Number.parseFloat(li.price),
      discount: Number.parseFloat(li.discount),
      quantity: li.quantity,
      facilityCode,
    }));

    const address = order.shipping_address as Record<string, unknown>;
    const billingAddr = order.billing_address as Record<string, unknown>;
    const customer = order.customer as Record<string, unknown>;

    const payload: Record<string, unknown> = {
      saleOrderDTO: {
        code: `ratio-${order.id}`,
        displayOrderCode: order.order_number,
        channel: 'RATIO',
        created: order.created_at,
        cashOnDelivery: order.payment_method === 'cod',
        currencyCode: order.currency,
        notificationEmail: order.email,
        notificationMobile: order.phone,
        customerCode: String(customer.id ?? ''),
        addresses: [
          {
            id: 'shipping',
            name: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim(),
            addressLine1: String(address.address1 ?? ''),
            addressLine2: String(address.address2 ?? ''),
            city: String(address.city ?? ''),
            state: String(address.state ?? ''),
            country: 'IN',
            pincode: String(address.zip ?? ''),
            phone: String(address.phone ?? ''),
          },
          {
            id: 'billing',
            name: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim(),
            addressLine1: String(billingAddr.address1 ?? ''),
            addressLine2: String(billingAddr.address2 ?? ''),
            city: String(billingAddr.city ?? ''),
            state: String(billingAddr.state ?? ''),
            country: 'IN',
            pincode: String(billingAddr.zip ?? ''),
            phone: String(billingAddr.phone ?? ''),
          },
        ],
        billingAddress: { ref: 'billing' },
        shippingAddress: { ref: 'shipping' },
        saleOrderItems,
      },
    };

    try {
      const response = await this.ucMock.createSaleOrder(creds.tenantSlug, token, payload);
      if (!response.successful) {
        const errorMsg = response.errors?.join('; ') ?? 'UC order creation failed';
        await this.syncQueue.enqueue(merchantId, order.id, 'order_push');
        await this.circuitBreaker.recordFailure(merchantId);
        this.logger.error({ msg: 'order push failed', merchantId, orderId: order.id, error: errorMsg });
        return null;
      }

      await this.ratioMock.updateOrder(order.id, { uc_order_code: response.saleOrderCode });
      await this.circuitBreaker.recordSuccess(merchantId);
      this.logger.log({ msg: 'order pushed to UC', merchantId, orderId: order.id, ucCode: response.saleOrderCode });
      return response.saleOrderCode;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.syncQueue.enqueue(merchantId, order.id, 'order_push');
      await this.circuitBreaker.recordFailure(merchantId);
      this.logger.error({ msg: 'order push exception', merchantId, orderId: order.id, error: errorMsg });
      return null;
    }
  }

  async pushPendingOrders(merchantId: string): Promise<number> {
    const pendingItems = await this.syncQueue.getPendingItems(merchantId);
    let pushed = 0;
    for (const item of pendingItems) {
      if (item.syncType !== 'order_push') continue;
      try {
        await this.syncQueue.markSuccess(item.id);
        pushed++;
      } catch (err) {
        await this.syncQueue.markFailed(item.id, err instanceof Error ? err.message : String(err));
      }
    }
    return pushed;
  }
}
