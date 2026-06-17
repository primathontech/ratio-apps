import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import { FeedSyncService } from './feed-sync.service';

/**
 * Hourly GMC reconciliation: re-syncs every active merchant that has GMC + the
 * hourly-reconcile toggle on, repairing any drift between the Ratio catalog and
 * the GMC feed. Each run is logged to `google_sync_log` (via FeedSyncService).
 *
 * Single-runner guard (TRD R2): an in-process `running` flag prevents an
 * overlapping cycle on the same pod if a run overruns the hour. For multi-pod
 * deployments this should be promoted to a DB advisory lock
 * (`GET_LOCK('google_reconcile', 0)`) so only one pod runs a given cycle —
 * left as a single seam (`acquire`/`release`) so that swap is local.
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);
  private running = false;

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    private readonly feedSync: FeedSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    await this.runReconcileCycle();
  }

  /** Run one reconcile pass over all eligible merchants. Skips if already running. */
  async runReconcileCycle(): Promise<{ ran: boolean; merchants: number }> {
    if (this.running) {
      this.logger.warn({ msg: 'reconcile already running — skipping overlapping cycle' });
      return { ran: false, merchants: 0 };
    }
    this.running = true;
    try {
      const merchants = await this.handle.db
        .selectFrom('google_configs')
        .innerJoin('merchants', 'merchants.id', 'google_configs.merchantId')
        .select(['google_configs.merchantId as merchantId'])
        .where('merchants.isActive', '=', true)
        .where('google_configs.gmcEnabled', '=', true)
        .where('google_configs.hourlyReconcileEnabled', '=', true)
        .execute();

      for (const { merchantId } of merchants) {
        try {
          await this.feedSync.fullSync(merchantId, 'reconcile');
        } catch (err) {
          this.logger.error({ msg: 'reconcile failed for merchant', merchantId, err: `${err}` });
        }
      }
      return { ran: true, merchants: merchants.length };
    } finally {
      this.running = false;
    }
  }
}
