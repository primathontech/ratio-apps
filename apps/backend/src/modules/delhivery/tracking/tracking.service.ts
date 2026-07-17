import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DELHIVERY_CARRIER,
  type DelhiveryShipmentStatus,
  KWIKENGAGE_EVENT_BY_STATUS,
} from '@ratio-app/shared/constants/delhivery-events';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { DelhiveryDatabase, DelhiveryShipmentRow } from '../db/types';
import type { KwikEngagePort } from '../events/kwikengage.client';
import { DELHIVERY_DB_TOKEN } from '../kysely.module';
import type { RatioOrdersPort, RestockItem } from '../ratio/ratio-orders.service';
import type { DelhiveryScan } from '../sdk/sdk.service';
import { DELHIVERY_KWIKENGAGE, DELHIVERY_ORDERS } from '../tokens';

type Rec = Record<string, unknown>;

/**
 * Normalize a Delhivery scan (StatusType + Status text) onto the unified
 * Ratio status set. Delhivery's StatusType codes:
 *   DL = delivered, RT = return (RTO), CN = cancelled,
 *   UD = undelivered/in-progress — disambiguated by the Status text
 *   (Manifested / In Transit / Dispatched / attempt-failed → NDR).
 */
export function mapDelhiveryStatus(scan: Pick<DelhiveryScan, 'statusType' | 'status'>): DelhiveryShipmentStatus {
  const type = (scan.statusType ?? '').toUpperCase();
  const status = (scan.status ?? '').toLowerCase();

  if (type === 'DL') {
    return status.includes('rto') || status.includes('return') ? 'rto_completed' : 'delivered';
  }
  if (type === 'RT') return 'rto_completed';
  if (type === 'CN') return 'shipment_cancelled';

  // UD (or missing type): read the status text.
  if (status.includes('manifest')) return 'awaiting_pickup';
  if (status.includes('out for delivery') || status.includes('dispatched')) return 'out_for_delivery';
  if (status.includes('in transit') || status.includes('picked')) return 'in_transit';
  if (status.includes('deliver') && !status.includes('not')) {
    return type === 'UD' ? 'delivery_failed' : 'delivered';
  }
  if (type === 'UD') return 'delivery_failed'; // pending / undelivered / NDR
  return 'in_transit';
}

/**
 * Applies tracking scans to shipments: normalize → dedupe → persist event →
 * update the shipment row → mirror the order → fire the KwikEngage shipping
 * event — exactly once per `(awb, unified_status)` transition (backed by the
 * unique constraint on `delhivery_tracking_events`).
 *
 * Side effects per status:
 *   - `delivery_failed` (NDR): status only — resolution stays in the
 *     Delhivery dashboard (read-only in our admin).
 *   - `rto_completed`: Inventory `increment_stock` for the order's items;
 *     refund trigger for Prepaid orders (COD → nothing to refund).
 */
@Injectable()
export class DelhiveryTrackingService {
  private readonly logger = new Logger(DelhiveryTrackingService.name);

  constructor(
    @Inject(DELHIVERY_DB_TOKEN) private readonly handle: KyselyClient<DelhiveryDatabase>,
    @Inject(DELHIVERY_ORDERS) private readonly orders: RatioOrdersPort,
    @Inject(DELHIVERY_KWIKENGAGE) private readonly kwikengage: KwikEngagePort,
  ) {}

  /**
   * Apply one scan. Returns the unified status when the transition was newly
   * applied, or null when deduped/ignored.
   */
  async applyScan(
    shipment: DelhiveryShipmentRow,
    scan: DelhiveryScan,
  ): Promise<DelhiveryShipmentStatus | null> {
    if (!shipment.awb) return null;
    const unified = mapDelhiveryStatus(scan);

    // Dedupe per StatusType transition: one event row per (awb, unified).
    const seen = await this.handle.db
      .selectFrom('delhivery_tracking_events')
      .select('id')
      .where('awb', '=', shipment.awb)
      .where('unifiedStatus', '=', unified)
      .limit(1)
      .executeTakeFirst();
    if (seen) return null;

    try {
      await this.handle.db
        .insertInto('delhivery_tracking_events')
        .values({
          id: randomUUID(),
          awb: shipment.awb,
          rawStatus: scan.status || scan.statusType || 'unknown',
          unifiedStatus: unified,
          location: scan.location,
          eventTs: scan.timestamp ? new Date(scan.timestamp) : null,
        } as never)
        .execute();
    } catch (err) {
      // Unique (awb, unified_status) race — another poller won. Deduped.
      this.logger.warn({ msg: 'tracking event dedupe (unique)', awb: shipment.awb, unified, err: `${err}` });
      return null;
    }

    await this.handle.db
      .updateTable('delhivery_shipments')
      .set({
        status: unified,
        ...(unified === 'shipment_cancelled' ? { active: false } : {}),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('id', '=', shipment.id)
      .execute();

    // Mirror the unified status to the platform order (Admin order view).
    try {
      await this.orders.patchOrder(shipment.merchantId, shipment.orderId, {
        fulfillment_status: unified,
        tracking_number: shipment.awb,
        carrier: DELHIVERY_CARRIER,
      });
    } catch (err) {
      // The module DB is the source of truth; a mirror miss self-heals on the
      // next transition. Don't fail the poll cycle for it.
      this.logger.warn({ msg: 'order mirror failed', orderId: shipment.orderId, err: `${err}` });
    }

    // App-side KwikEngage shipping event — deduped by the insert above.
    await this.kwikengage.sendShippingEvent(shipment.merchantId, KWIKENGAGE_EVENT_BY_STATUS[unified], {
      awb: shipment.awb,
      order_id: shipment.orderId,
      order_number: shipment.orderNumber,
      status: unified,
      carrier: DELHIVERY_CARRIER,
      ...(scan.location ? { location: scan.location } : {}),
    });

    if (unified === 'rto_completed') {
      await this.handleRto(shipment);
    }

    this.logger.log({ msg: 'tracking transition', awb: shipment.awb, unified });
    return unified;
  }

  /** RTO: restock the order's items; refund when Prepaid (COD → no refund). */
  private async handleRto(shipment: DelhiveryShipmentRow): Promise<void> {
    try {
      const order = await this.orders.getOrder(shipment.merchantId, shipment.orderId);
      const items = this.restockItems(order);
      if (items.length > 0) {
        await this.orders.incrementStock(shipment.merchantId, items);
      }
      if (shipment.paymentMode === 'Prepaid') {
        await this.orders.createRefund(shipment.merchantId, shipment.orderId);
      }
    } catch (err) {
      // Restock/refund are best-effort follow-ups; the RTO status itself is
      // already persisted + mirrored. Ops can replay from the admin.
      this.logger.error({ msg: 'RTO follow-up failed', awb: shipment.awb, err: `${err}` });
    }
  }

  private restockItems(order: Rec | null): RestockItem[] {
    const items = (order?.line_items ?? order?.items) as unknown;
    if (!Array.isArray(items)) return [];
    const out: RestockItem[] = [];
    for (const raw of items) {
      const item = raw as Rec;
      const pid = item.product_id ?? item.productId;
      if (typeof pid !== 'string' && typeof pid !== 'number') continue;
      const vid = item.variant_id ?? item.variantId;
      out.push({
        productId: String(pid),
        ...(typeof vid === 'string' || typeof vid === 'number' ? { variantId: String(vid) } : {}),
        quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
      });
    }
    return out;
  }
}
