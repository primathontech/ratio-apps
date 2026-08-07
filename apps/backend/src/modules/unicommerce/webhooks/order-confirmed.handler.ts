import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../core/webhooks/webhook-log.types';
import type { WebhookHandler } from '../../../core/webhooks/webhooks.types';
import type { UnicommerceDatabase } from '../db/types';
import { buildEventLogRow } from '../services/event-log.service';
import { UcFeatureFlagsService } from '../services/feature-flags.service';
import { UcOrderItemMapService } from '../services/order-item-map.service';
import { UcSyncQueueService } from '../services/sync-queue.service';

export const UC_ORDER_WEBHOOK_TOPICS = {
  orderCreated: 'orders/create',
  orderCancelled: 'orders/cancelled',
} as const;

// SLA offset in days — no Ratio-side source field for UC's mandatory `sla`
// (TRD §2.9 open item); read from env at call time so tests aren't coupled
// to `ConfigService` wiring for this one small, independently-decided value.
const SLA_OFFSET_DAYS = Number(process.env.UC_ORDER_SLA_OFFSET_DAYS ?? 2);

interface RatioAddress {
  first_name?: string;
  last_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  zip?: string;
  phone?: string;
}

interface RatioDiscountAllocation {
  amount: string;
}

interface RatioOrderLineItem {
  id: string;
  product_id: string;
  variant_id: string;
  sku: string;
  title: string;
  quantity: number;
  price: string;
  discount_allocations?: RatioDiscountAllocation[];
}

export interface RatioOrderPayload {
  id: string;
  name?: string;
  created_at: string;
  email?: string;
  payment_gateway_names?: string[];
  total_discounts?: number;
  shipping_lines?: { price: number }[];
  shipping_address?: RatioAddress;
  billing_address?: RatioAddress;
  line_items: RatioOrderLineItem[];
  [key: string]: unknown;
}

// Explicit IST (UTC+5:30) conversion — Unicommerce's own docs fix other
// timestamp fields to this offset (e.g. `orderDateFrom`/`orderDateTo` as
// `+05:30`), and this is an India-only logistics platform, so `orderDate`/
// `sla` are formatted the same way. Computed from the UTC epoch directly
// rather than relying on `Date`'s local-timezone getters, which would
// silently produce the wrong wall-clock time on a server not configured
// for IST (e.g. a UTC-default cloud deployment).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function formatUcDateTime(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`;
}

// No direct Ratio field for COD vs. prepaid — inferred from
// `payment_gateway_names`, pending Product sign-off (TRD §2.9).
function inferPaymentType(order: RatioOrderPayload): 'COD' | 'PREPAID' {
  const gateways = order.payment_gateway_names ?? [];
  return gateways.some((g) => /cod/i.test(g)) ? 'COD' : 'PREPAID';
}

function buildUcAddress(addr: RatioAddress | undefined, email: string | undefined) {
  return {
    addressLine1: addr?.address1 ?? '',
    addressLine2: addr?.address2,
    city: addr?.city ?? '',
    country: addr?.country ?? '',
    email,
    name: [addr?.first_name, addr?.last_name].filter(Boolean).join(' '),
    phone: addr?.phone,
    pincode: addr?.zip ?? '',
    state: addr?.province ?? '',
  };
}

function buildUcOrderItem(item: RatioOrderLineItem, orderItemId: string) {
  const sellingPrice = Number(item.price) / 100;
  const discount = (item.discount_allocations ?? []).reduce((sum, d) => sum + Number(d.amount), 0) / 100;
  return {
    orderItemId,
    productId: item.product_id,
    variantId: item.variant_id,
    sku: item.sku,
    title: item.title,
    quantity: item.quantity,
    shippingMethodCode: 'STD' as const,
    orderItemPrice: {
      sellingPrice,
      totalPrice: sellingPrice * item.quantity - discount,
      discount,
    },
  };
}

// Shared by both the `orders/create` webhook handler (below) and
// `UcReconciliationSweepService` (which enqueues an order_push for any order
// its sweep finds missing a uc_sync_jobs row) — extracted so the tricky
// parts (IST date formatting, paisa→rupee price conversion, address
// mapping) live in exactly one place instead of being hand-duplicated.
export async function buildOrderPushJobPayload(
  orderItemMap: UcOrderItemMapService,
  merchantId: string,
  order: RatioOrderPayload,
): Promise<{ merchantId: string; ratioOrderId: string; order: Record<string, unknown> }> {
  const orderItems = [];
  for (const item of order.line_items) {
    const orderItemId = await orderItemMap.generate(
      merchantId,
      order.id,
      item.id,
      item.quantity,
      'ratio_originated',
    );
    orderItems.push(buildUcOrderItem(item, orderItemId));
  }

  const createdAt = new Date(order.created_at);
  const orderDate = formatUcDateTime(createdAt);
  const sla = formatUcDateTime(
    new Date(createdAt.getTime() + SLA_OFFSET_DAYS * 24 * 60 * 60 * 1000),
  );
  const totalShippingCharges =
    (order.shipping_lines ?? []).reduce((sum, l) => sum + Number(l.price), 0) / 100;
  const shippingAddress = buildUcAddress(order.shipping_address, order.email);
  const billingAddress = buildUcAddress(order.billing_address, order.email);

  return {
    merchantId,
    ratioOrderId: order.id,
    // `order` here is the real POST uc/v1/order contract (TRD §2.9) — no
    // saleOrderDTO wrapper, no customerGSTIN/facilityCode/giftWrap (no Ratio
    // source for any of them, confirmed — omitted rather than guessed).
    order: {
      id: order.id,
      displayOrderNumber: order.name,
      orderDate,
      orderStatus: 'CREATED',
      sla,
      priority: 0,
      paymentType: inferPaymentType(order),
      taxExempted: false,
      cFormProvided: false,
      thirdPartyShipping: false,
      orderPrice: {
        currency: 'INR',
        totalDiscount: (order.total_discounts ?? 0) / 100,
        totalShippingCharges,
      },
      shippingAddress,
      billingAddress,
      orderItems,
    },
  };
}

@Injectable()
export class UcOrderConfirmedHandler implements WebhookHandler {
  readonly topic = UC_ORDER_WEBHOOK_TOPICS.orderCreated;
  private readonly logger = new Logger(UcOrderConfirmedHandler.name);

  constructor(
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly syncQueue: UcSyncQueueService,
    private readonly featureFlags: UcFeatureFlagsService,
  ) {}

  async handle(
    data: Record<string, unknown>,
    merchantId: string | null,
    trx: Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>,
  ): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ msg: 'orders/create for unknown merchant — no-op' });
      return;
    }
    const ucTrx = trx as unknown as Transaction<UnicommerceDatabase>;
    const order = data as unknown as RatioOrderPayload;

    // TRD §6: true earliest gate — checked BEFORE any `uc_order_item_map`
    // rows are generated (a real DB write) or an outbound push job is
    // created. When order_push is disabled UC never learns about this order,
    // so pre-creating mapping rows for it serves no purpose.
    if (!(await this.featureFlags.isEnabled('order_push', merchantId))) {
      this.logger.log({
        msg: 'order_push flag disabled — skipping outbound push',
        merchantId,
        ratioOrderId: order.id,
      });
      await ucTrx
        .insertInto('ucEventLogs')
        .values(
          buildEventLogRow({
            merchantId,
            direction: 'inbound',
            flow: 'webhook',
            reference: `${this.topic}: ${order.id}`,
            result: 'success',
            payload: order,
            response: 'order_push flag disabled — outbound push skipped',
          }),
        )
        .execute();
      return;
    }

    const payload = await buildOrderPushJobPayload(this.orderItemMap, merchantId, order);
    const jobId = randomUUID();
    // `merchantId`/`ratioOrderId` sit alongside `order` because
    // `UcSyncQueueService`/`UcOrderPushWorkerService` need them for
    // credential lookup and logging — they are not part of UC's contract
    // and must never be spread into the `order` object sent over HTTP.
    await ucTrx
      .insertInto('ucSyncJobs')
      .values({
        id: jobId,
        merchantId,
        type: 'order_push',
        ratioOrderId: order.id,
        payload: JSON.stringify(payload) as unknown as Record<string, unknown>,
        status: 'PENDING',
      })
      .execute();

    await ucTrx
      .insertInto('ucEventLogs')
      .values(
        buildEventLogRow({
          merchantId,
          direction: 'inbound',
          flow: 'webhook',
          reference: `${this.topic}: ${order.id}`,
          result: 'success',
          payload: order,
          response: { queuedJobId: jobId },
        }),
      )
      .execute();

    this.syncQueue
      .publish(jobId, { merchantId, type: 'order_push', ratioOrderId: order.id })
      .catch((err: unknown) => {
        this.logger.warn({
          msg: 'Kafka publish failed after enqueue; job is PENDING in DB',
          jobId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
