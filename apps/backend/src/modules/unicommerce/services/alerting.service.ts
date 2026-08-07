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

/**
 * Proactive alerting for the Unicommerce connector (TRD §5.2):
 *
 * Signal B — inbound-channel silence:
 *   Any active merchant whose `last_status_notification_at` (updated on
 *   every inbound `POST /order/{orderId}` call, regardless of outcome) is
 *   older than INBOUND_SILENCE_HOURS. Creates a merchant-wide
 *   `INBOUND_SILENCE` alert (`reference` null).
 *
 * Signal A — per-order staleness — no longer lives here: the flat 48h
 * threshold over `uc_order_item_map` was superseded by the stage-aware pass
 * in `UcReconciliationSweepService`'s 30-minute canary tick
 * (`checkStaleRatioOrders`), which classifies live Ratio orders via
 * `order-stage-mapping.ts` and raises `STALE_ORDER` alerts per stage
 * threshold. `STALE_ORDER` rows in `ucAlerts` are still read and
 * acknowledged here — they are just no longer created by this service.
 *
 * Signal B is run by `checkAll()`, called from a cron. Each check is
 * deduplicated against any existing unacknowledged alert of the same type so
 * a detection that keeps re-firing doesn't spam a fresh row every cycle.
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

  async checkAll(): Promise<{ signalB: number }> {
    const signalB = await this.checkInboundSilence();
    return { signalB };
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
}
