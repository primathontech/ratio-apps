import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DELHIVERY_IN_FLIGHT_STATUSES } from '@ratio-app/shared/constants/delhivery-events';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { DelhiveryDatabase, DelhiveryShipmentRow } from '../db/types';
import { DELHIVERY_DB_TOKEN } from '../kysely.module';
import { DelhiverySdkService } from '../sdk/sdk.service';
import { DelhiveryTrackingService } from './tracking.service';

/**
 * Poll-first tracking (PRD: push webhooks are v1.1). Every 30 minutes, poll
 * Delhivery for every ACTIVE in-flight AWB of every active+enabled merchant,
 * and feed each scan through {@link DelhiveryTrackingService.applyScan} —
 * which dedupes per transition, so re-polling the same scans is free.
 *
 * Single-runner guard: an in-process `running` flag prevents overlapping
 * cycles on the same pod (mirrors google's ReconcileService; promote to a DB
 * advisory lock for multi-pod).
 */
@Injectable()
export class TrackingReconcileCron {
  private readonly logger = new Logger(TrackingReconcileCron.name);
  private running = false;

  constructor(
    @Inject(DELHIVERY_DB_TOKEN) private readonly handle: KyselyClient<DelhiveryDatabase>,
    private readonly sdk: DelhiverySdkService,
    private readonly tracking: DelhiveryTrackingService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async cycle(): Promise<void> {
    await this.pollOnce();
  }

  /** One poll pass over all in-flight shipments. Exposed for deterministic tests. */
  async pollOnce(): Promise<{ ran: boolean; polled: number }> {
    if (this.running) {
      this.logger.warn({ msg: 'tracking poll already running — skipping overlapping cycle' });
      return { ran: false, polled: 0 };
    }
    this.running = true;
    try {
      const shipments = (await this.handle.db
        .selectFrom('delhivery_shipments')
        .innerJoin('merchants', 'merchants.id', 'delhivery_shipments.merchantId')
        .innerJoin('delhivery_configs', 'delhivery_configs.merchantId', 'delhivery_shipments.merchantId')
        .selectAll('delhivery_shipments')
        .where('merchants.isActive', '=', true)
        .where('delhivery_configs.enabled', '=', true)
        .where('delhivery_shipments.active', '=', true)
        .where('delhivery_shipments.awb', 'is not', null)
        .where('delhivery_shipments.status', 'in', [...DELHIVERY_IN_FLIGHT_STATUSES])
        .execute()) as DelhiveryShipmentRow[];

      for (const shipment of shipments) {
        if (!shipment.awb) continue;
        try {
          const scans = await this.sdk.track(shipment.merchantId, shipment.awb);
          for (const scan of scans) {
            await this.tracking.applyScan(shipment, scan);
          }
        } catch (err) {
          // One bad AWB (or one merchant's 429) never kills the cycle.
          this.logger.error({ msg: 'tracking poll failed for awb', awb: shipment.awb, err: `${err}` });
        }
      }
      return { ran: true, polled: shipments.length };
    } finally {
      this.running = false;
    }
  }
}
