import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DELHIVERY_CARRIER } from '@ratio-app/shared/constants/delhivery-events';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { DelhiveryConfigService } from '../config/config.service';
import type { DelhiveryDatabase, DelhiveryShipmentRow, DelhiveryTrackingEventRow } from '../db/types';
import { DELHIVERY_DB_TOKEN } from '../kysely.module';
import type { RatioOrdersPort } from '../ratio/ratio-orders.service';
import { DelhiverySdkService } from '../sdk/sdk.service';
import { DELHIVERY_ORDERS } from '../tokens';
import { buildPackage } from './build-package';
import { mapPaymentMode } from './payment';

type Rec = Record<string, unknown>;

export interface OrderRef {
  orderId: string;
  orderNumber?: string | undefined;
}

/** A paid + unfulfilled order with no shipment yet, awaiting a manual AWB. */
export interface PendingOrder {
  orderId: string;
  orderNumber: string;
  customerName: string;
  amountRupees: number;
  city: string;
  createdAt: string;
}

const PAGE_SIZE = 20;

function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

/** A cancelled order stays paid + unfulfilled, so keep it off the AWB worklist. */
function isCancelled(order: Rec): boolean {
  const cancelledAt = order.cancelled_at ?? order.cancelledAt;
  if (cancelledAt != null && cancelledAt !== '') return true;
  const status = str(order.status ?? order.order_status).toLowerCase();
  return status === 'cancelled' || status === 'canceled';
}

/**
 * Shipment lifecycle — create (manifestation → AWB), cancel, recreate, list.
 * The `delhivery_shipments` row is the SOURCE OF TRUTH; every state change is
 * mirrored to the platform order (`PATCH /orders/{id}` fulfillment_status +
 * tracking summary, `PATCH /orders/{id}/external-id` = AWB).
 *
 * Idempotency: `order_number` is UNIQUE per merchant and doubles as
 * Delhivery's `order` field (Delhivery rejects duplicate orders too). A
 * retry after a mid-flight crash finds the existing ACTIVE row, re-runs the
 * (idempotent) order mirror, and never mints a second AWB.
 */
@Injectable()
export class DelhiveryShipmentService {
  private readonly logger = new Logger(DelhiveryShipmentService.name);

  constructor(
    @Inject(DELHIVERY_DB_TOKEN) private readonly handle: KyselyClient<DelhiveryDatabase>,
    private readonly configs: DelhiveryConfigService,
    private readonly sdk: DelhiverySdkService,
    @Inject(DELHIVERY_ORDERS) private readonly orders: RatioOrdersPort,
  ) {}

  /**
   * Create the shipment for a paid order.
   *
   * Skips (returns null) when: config disabled; auto-trigger requested but
   * the merchant is in `manual` mode; the order is gone. Returns the existing
   * row (after re-mirroring) when an active shipment already exists for the
   * order_number — the idempotency guarantee.
   */
  async createForOrder(
    merchantId: string,
    ref: OrderRef,
    opts: { manual?: boolean } = {},
  ): Promise<DelhiveryShipmentRow | null> {
    const config = await this.configs.getByMerchantId(merchantId);
    if (!config.enabled) {
      this.logger.log({ msg: 'delhivery disabled for merchant — skip', merchantId });
      return null;
    }
    if (!opts.manual && config.awbTrigger !== 'auto') {
      this.logger.log({ msg: 'awb trigger is manual — skip auto create', merchantId });
      return null;
    }

    const order = await this.orders.getOrder(merchantId, ref.orderId);
    if (!order) {
      this.logger.warn({ msg: 'order not found — skip', merchantId, orderId: ref.orderId });
      return null;
    }
    const orderNumber = str(order.order_number ?? order.orderNumber, ref.orderNumber ?? ref.orderId);

    // Idempotency: one active shipment per order_number.
    const existing = await this.findByOrderNumber(merchantId, orderNumber);
    if (existing?.active && existing.awb) {
      // A retry after mirror failure: re-mirror (idempotent PATCH), no 2nd AWB.
      await this.mirrorToOrder(merchantId, existing.orderId, existing.awb, existing.status);
      return existing;
    }

    const products = await this.loadProducts(merchantId, order);
    const pkg = buildPackage(order, products, config.defaultBox);
    const payment = mapPaymentMode(order);
    const address = (order.shipping_address ?? order.shippingAddress ?? {}) as Rec;

    const { awb } = await this.sdk.createShipment(merchantId, {
      orderNumber,
      paymentMode: payment.mode,
      codAmount: payment.codAmount,
      // paise → rupees (see mapPaymentMode).
      totalAmount: Number(order.total_price ?? order.total_amount ?? 0) / 100 || payment.codAmount,
      weightGrams: pkg.weightGrams,
      dims: pkg.dims,
      hsnCode: pkg.hsnCode,
      productsDesc: pkg.productsDesc,
      quantity: pkg.quantity,
      consignee: {
        name: str(address.name ?? `${str(address.first_name)} ${str(address.last_name)}`.trim()),
        address: [address.address1, address.address2].filter(Boolean).map(String).join(', '),
        pincode: str(address.zip ?? address.pincode ?? address.postal_code),
        city: str(address.city),
        state: str(address.province ?? address.state),
        country: str(address.country, 'India'),
        phone: str(address.phone ?? order.phone),
      },
    });

    let row: DelhiveryShipmentRow;
    if (existing) {
      // A cancelled row for this order_number exists (unique key) → revive it.
      await this.handle.db
        .updateTable('delhivery_shipments')
        .set({
          awb,
          status: 'awaiting_pickup',
          active: true,
          paymentMode: payment.mode,
          codAmount: payment.codAmount,
          weightGrams: pkg.weightGrams,
          pickupRequestedAt: null,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        } as never)
        .where('id', '=', existing.id)
        .execute();
      row = {
        ...existing,
        awb,
        status: 'awaiting_pickup',
        active: true,
        paymentMode: payment.mode,
        codAmount: payment.codAmount,
        weightGrams: pkg.weightGrams,
      };
    } else {
      const id = randomUUID();
      await this.handle.db
        .insertInto('delhivery_shipments')
        .values({
          id,
          merchantId,
          orderId: ref.orderId,
          orderNumber,
          awb,
          status: 'awaiting_pickup',
          paymentMode: payment.mode,
          codAmount: payment.codAmount,
          weightGrams: pkg.weightGrams,
        })
        .execute();
      row = {
        id,
        merchantId,
        orderId: ref.orderId,
        orderNumber,
        awb,
        carrier: DELHIVERY_CARRIER,
        status: 'awaiting_pickup',
        paymentMode: payment.mode,
        codAmount: payment.codAmount,
        weightGrams: pkg.weightGrams,
        labelUrl: null,
        estimatedDelivery: null,
        active: true,
        pickupRequestedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    // Mirror AWB + fulfillment status to the platform order. A failure here
    // throws → the queue message redelivers → the idempotent branch above
    // re-mirrors without minting another AWB.
    await this.mirrorToOrder(merchantId, ref.orderId, awb, 'awaiting_pickup');
    this.logger.log({ msg: 'shipment created', merchantId, orderNumber, awb });
    return row;
  }

  /** orders/cancelled → cancel the AWB pre-pickup, mark the row cancelled. */
  async cancelForOrder(merchantId: string, ref: OrderRef): Promise<DelhiveryShipmentRow | null> {
    const orderNumber = ref.orderNumber;
    const shipment = orderNumber
      ? await this.findByOrderNumber(merchantId, orderNumber)
      : await this.findByOrderId(merchantId, ref.orderId);
    if (!shipment || !shipment.active) return null;

    if (shipment.status === 'awaiting_pickup' && shipment.awb) {
      await this.sdk.cancelShipment(merchantId, shipment.awb);
    }
    await this.handle.db
      .updateTable('delhivery_shipments')
      .set({
        status: 'shipment_cancelled',
        active: false,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('id', '=', shipment.id)
      .execute();
    await this.mirrorToOrder(merchantId, shipment.orderId, shipment.awb, 'shipment_cancelled');
    this.logger.log({ msg: 'shipment cancelled', merchantId, awb: shipment.awb });
    return { ...shipment, status: 'shipment_cancelled', active: false };
  }

  /**
   * orders/edited (address/COD change) — pre-pickup only: cancel the old AWB
   * and manifest a fresh one on the same row. Post-pickup edits are a no-op
   * (managed in the Delhivery dashboard).
   */
  async recreateForOrder(merchantId: string, ref: OrderRef): Promise<DelhiveryShipmentRow | null> {
    const shipment = ref.orderNumber
      ? await this.findByOrderNumber(merchantId, ref.orderNumber)
      : await this.findByOrderId(merchantId, ref.orderId);
    if (!shipment) {
      // Nothing manifested yet — treat the edit as the create trigger.
      return this.createForOrder(merchantId, ref);
    }
    if (!shipment.active || shipment.status !== 'awaiting_pickup') {
      this.logger.log({ msg: 'edit after pickup — no recreate', merchantId, awb: shipment.awb });
      return null;
    }
    if (shipment.awb) await this.sdk.cancelShipment(merchantId, shipment.awb);
    // Mark cancelled so createForOrder's revive branch re-manifests in place.
    await this.handle.db
      .updateTable('delhivery_shipments')
      .set({ status: 'shipment_cancelled', active: false, updatedAt: sql`CURRENT_TIMESTAMP(3)` } as never)
      .where('id', '=', shipment.id)
      .execute();
    return this.createForOrder(merchantId, { orderId: shipment.orderId, orderNumber: shipment.orderNumber });
  }

  async list(
    merchantId: string,
    opts: { page?: number | undefined; status?: string | undefined } = {},
  ): Promise<{ items: DelhiveryShipmentRow[]; page: number; pageSize: number }> {
    const page = Math.max(1, opts.page ?? 1);
    let query = this.handle.db
      .selectFrom('delhivery_shipments')
      .selectAll()
      .where('merchantId', '=', merchantId);
    if (opts.status) query = query.where('status', '=', opts.status);
    const items = (await query
      .orderBy('createdAt', 'desc')
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .execute()) as DelhiveryShipmentRow[];
    return { items, page, pageSize: PAGE_SIZE };
  }

  /**
   * Paid + unfulfilled orders with no shipment row yet; the manual "Create
   * AWB" worklist. Excludes already-shipped orders in one batch SELECT keyed
   * on the UNIQUE order_number.
   */
  async listPendingOrders(merchantId: string): Promise<PendingOrder[]> {
    const orders = await this.orders.listOrders(merchantId, {
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
    });
    const withNumbers = orders
      .filter((order) => !isCancelled(order))
      .map((order) => ({
        order,
        orderNumber: str(order.order_number ?? order.orderNumber, str(order.id)),
      }));

    const orderNumbers = withNumbers.map((o) => o.orderNumber).filter(Boolean);
    const taken = new Set<string>();
    if (orderNumbers.length > 0) {
      const rows = (await this.handle.db
        .selectFrom('delhivery_shipments')
        .select('orderNumber')
        .where('merchantId', '=', merchantId)
        .where('orderNumber', 'in', orderNumbers)
        .where('active', '=', true)
        .execute()) as { orderNumber: string }[];
      for (const r of rows) taken.add(r.orderNumber);
    }

    return withNumbers
      .filter((o) => !taken.has(o.orderNumber))
      .map(({ order, orderNumber }) => {
        const address = (order.shipping_address ?? order.shippingAddress ?? {}) as Rec;
        const customer = (order.customer ?? {}) as Rec;
        const fullName = `${str(customer.first_name)} ${str(customer.last_name)}`.trim();
        return {
          orderId: str(order.id),
          orderNumber,
          customerName: fullName || str(address.name),
          amountRupees: Number(order.total_price ?? order.total_amount ?? 0) / 100,
          city: str(address.city),
          createdAt: str(order.created_at ?? order.createdAt),
        };
      });
  }

  /** Shipment + its tracking timeline (for the admin detail view). */
  async detail(
    merchantId: string,
    id: string,
  ): Promise<{ shipment: DelhiveryShipmentRow; events: DelhiveryTrackingEventRow[] }> {
    const shipment = (await this.handle.db
      .selectFrom('delhivery_shipments')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst()) as DelhiveryShipmentRow | undefined;
    if (!shipment) {
      throw new NotFoundException({ message: 'shipment not found', error_code: 'SHIPMENT_NOT_FOUND' });
    }
    const events = shipment.awb
      ? ((await this.handle.db
          .selectFrom('delhivery_tracking_events')
          .selectAll()
          .where('awb', '=', shipment.awb)
          .orderBy('createdAt', 'asc')
          .execute()) as DelhiveryTrackingEventRow[])
      : [];
    return { shipment, events };
  }

  async findByOrderNumber(
    merchantId: string,
    orderNumber: string,
  ): Promise<DelhiveryShipmentRow | undefined> {
    return (await this.handle.db
      .selectFrom('delhivery_shipments')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('orderNumber', '=', orderNumber)
      .limit(1)
      .executeTakeFirst()) as DelhiveryShipmentRow | undefined;
  }

  async findByOrderId(
    merchantId: string,
    orderId: string,
  ): Promise<DelhiveryShipmentRow | undefined> {
    return (await this.handle.db
      .selectFrom('delhivery_shipments')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('orderId', '=', orderId)
      .limit(1)
      .executeTakeFirst()) as DelhiveryShipmentRow | undefined;
  }

  async findByAwb(merchantId: string, awb: string): Promise<DelhiveryShipmentRow | undefined> {
    return (await this.handle.db
      .selectFrom('delhivery_shipments')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('awb', '=', awb)
      .limit(1)
      .executeTakeFirst()) as DelhiveryShipmentRow | undefined;
  }

  /**
   * Mirror the shipment summary onto the platform order — fulfillment_status
   * + tracking_number/carrier (native fields preferred; the platform ignores
   * unknown keys) and the AWB as the external order id.
   */
  private async mirrorToOrder(
    merchantId: string,
    orderId: string,
    awb: string | null,
    status: string,
  ): Promise<void> {
    await this.orders.patchOrder(merchantId, orderId, {
      fulfillment_status: status,
      ...(awb ? { tracking_number: awb, carrier: DELHIVERY_CARRIER } : {}),
    });
    if (awb) await this.orders.setExternalOrderId(merchantId, orderId, awb);
  }

  private async loadProducts(merchantId: string, order: Rec): Promise<Rec[]> {
    const items = (order.line_items ?? order.items) as unknown;
    if (!Array.isArray(items)) return [];
    const ids = new Set<string>();
    for (const raw of items) {
      const item = raw as Rec;
      const pid = item.product_id ?? item.productId;
      if (typeof pid === 'string' || typeof pid === 'number') ids.add(String(pid));
    }
    const products: Rec[] = [];
    for (const id of ids) {
      try {
        const product = await this.orders.getProduct(merchantId, id);
        if (product) products.push(product);
      } catch (err) {
        // Missing product data only degrades dims/hs_code — default box covers it.
        this.logger.warn({ msg: 'product fetch failed — default box fallback', id, err: `${err}` });
      }
    }
    return products;
  }
}
