import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { SingleRunnerGuard } from '../../../core/scheduling/single-runner';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';

export type AlertType = 'INBOUND_SILENCE' | 'STALE_ORDER';

// TRD §5.2 Signal B: 2-4h — the inbound status-notification channel calls
// frequently across a merchant's whole order book, so even a few hours of
// total silence is unusual on its own.
const INBOUND_SILENCE_HOURS = 3;
// TRD §5.2 Signal A: ~48h, tuned against normal fulfillment timelines.
const STALE_ORDER_HOURS = 48;
// Raw `last_status` values (uc_order_item_map) that mean the item has
// reached a terminal outcome — TRD §9's `uc_order_item_map` cleanup-cron
// note names this exact set for this exact column.
const TERMINAL_STATUSES = ['DELIVERED', 'RETURNED', 'COMPLETE', 'CANCELLED'];

/**
 * Proactive alerting for the Unicommerce connector (TRD §5.2):
 *
 * Signal A — per-order staleness:
 *   Any `uc_order_item_map` row not yet in a terminal `last_status`
 *   (TERMINAL_STATUSES) whose `last_status_updated_at` (or, if it never got
 *   a status update at all, `created_at`) is older than STALE_ORDER_HOURS.
 *   Creates a `STALE_ORDER` alert referencing the order's `ratio_order_id`
 *   (not the internal `order_item_id` — a human needs to be able to find
 *   this order) — coalesced across items, so two stale items on the same
 *   order produce one alert, not two.
 *
 * Signal B — inbound-channel silence:
 *   Any active merchant whose `last_status_notification_at` (updated on
 *   every inbound `POST /order/{orderId}` call, regardless of outcome) is
 *   older than INBOUND_SILENCE_HOURS. Creates a merchant-wide
 *   `INBOUND_SILENCE` alert (`reference` null).
 *
 * Both are run by `checkAll()`, called from a cron or a manual admin
 * endpoint. Each check is deduplicated against any existing unacknowledged
 * alert of the same type (+ reference, for Signal A) so a detection that
 * keeps re-firing doesn't spam a fresh row every cycle.
 */
@Injectable()
export class UcAlertingService {
  private readonly logger = new Logger(UcAlertingService.name);
  private readonly guard = new SingleRunnerGuard(this.logger, 'alerting check');

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
  ) {}

  // Same cadence as the reconciliation sweep — single-runner guard prevents
  // an overlapping cycle on the same pod if a run overruns the interval.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async everyTenMinutes(): Promise<void> {
    await this.guard.run(() => this.checkAll(), undefined);
  }

  async checkAll(): Promise<{ signalA: number; signalB: number }> {
    const signalA = await this.checkStaleOrders();
    const signalB = await this.checkInboundSilence();
    return { signalA, signalB };
  }

  async listAlerts(merchantId: string): Promise<Array<{
    id: string;
    merchantId: string;
    type: AlertType;
    reference: string | null;
    detectedAt: Date;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
  }>> {
    return this.handle.db
      .selectFrom('ucAlerts')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('detectedAt', 'desc')
      .execute();
  }

  async acknowledge(alertId: string, acknowledgedBy: string): Promise<void> {
    await this.handle.db
      .updateTable('ucAlerts')
      .set({ acknowledgedAt: new Date(), acknowledgedBy })
      .where('id', '=', alertId)
      .execute();
  }

  private async checkInboundSilence(): Promise<number> {
    const cutoff = new Date(Date.now() - INBOUND_SILENCE_HOURS * 60 * 60 * 1000);
    const silentMerchants = await this.handle.db
      .selectFrom('ucCredentials')
      .select('merchantId')
      .where('status', '=', 'active')
      .where((eb) =>
        eb.or([
          eb('lastStatusNotificationAt', '<', cutoff),
          eb('lastStatusNotificationAt', 'is', null),
        ]),
      )
      .execute();

    let created = 0;
    for (const m of silentMerchants) {
      const existing = await this.handle.db
        .selectFrom('ucAlerts')
        .select('id')
        .where('merchantId', '=', m.merchantId)
        .where('type', '=', 'INBOUND_SILENCE' as AlertType)
        .where('acknowledgedAt', 'is', null)
        .executeTakeFirst();
      if (existing) continue;

      await this.handle.db
        .insertInto('ucAlerts')
        .values({
          merchantId: m.merchantId,
          type: 'INBOUND_SILENCE',
        })
        .execute();
      created++;
      this.logger.warn({ msg: 'alert: inbound status-notification channel silent', merchantId: m.merchantId });
    }
    return created;
  }

  private async checkStaleOrders(): Promise<number> {
    const cutoffMs = Date.now() - STALE_ORDER_HOURS * 60 * 60 * 1000;
    const nonTerminalItems = await this.handle.db
      .selectFrom('ucOrderItemMap')
      .select(['orderItemId', 'merchantId', 'ratioOrderId', 'lastStatusUpdatedAt', 'createdAt'])
      .where((eb) =>
        eb.or([
          eb('lastStatus', 'is', null),
          eb('lastStatus', 'not in', TERMINAL_STATUSES),
        ]),
      )
      .execute();

    let created = 0;
    for (const item of nonTerminalItems) {
      const staleSince = (item.lastStatusUpdatedAt ?? item.createdAt).getTime();
      if (staleSince >= cutoffMs) continue;

      const existing = await this.handle.db
        .selectFrom('ucAlerts')
        .select('id')
        .where('merchantId', '=', item.merchantId)
        .where('type', '=', 'STALE_ORDER' as AlertType)
        .where('reference', '=', item.ratioOrderId)
        .where('acknowledgedAt', 'is', null)
        .executeTakeFirst();
      if (existing) continue;

      await this.handle.db
        .insertInto('ucAlerts')
        .values({
          merchantId: item.merchantId,
          type: 'STALE_ORDER',
          // The merchant-recognizable Ratio order id, not the internal
          // order_item_id — a person reading the alert needs to be able to
          // find this order, and this also coalesces multiple stale items
          // of the same order into one alert instead of one per item.
          reference: item.ratioOrderId,
        })
        .execute();
      created++;
      this.logger.warn({
        msg: 'alert: order stuck in a non-terminal status past the staleness threshold',
        merchantId: item.merchantId,
        ratioOrderId: item.ratioOrderId,
        orderItemId: item.orderItemId,
      });
    }
    return created;
  }
}
