import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';
import { CatalogSyncService } from './catalog-sync.service';

/**
 * Hourly Wizzy reconciliation: re-syncs every active merchant that has Wizzy
 * + auto-sync enabled, repairing any drift between the Ratio catalog and the
 * Wizzy index. Each run is logged to `wizzy_sync_log` (via CatalogSyncService).
 *
 * Single-runner guard: an in-process `running` flag prevents an overlapping
 * cycle on the same pod. For multi-pod deployments this should be promoted
 * to a DB advisory lock (`GET_LOCK('wizzy_reconcile', 0)`).
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);
  private running = false;

  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    private readonly catalogSync: CatalogSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourly(): Promise<void> {
    await this.runReconcileCycle();
  }

  async runReconcileCycle(): Promise<{ ran: boolean; merchants: number }> {
    if (this.running) {
      this.logger.warn({ msg: 'reconcile already running — skipping overlapping cycle' });
      return { ran: false, merchants: 0 };
    }
    this.running = true;
    try {
      const merchants = await this.handle.db
        .selectFrom('wizzy_configs')
        .innerJoin('merchants', 'merchants.id', 'wizzy_configs.merchantId')
        .select(['wizzy_configs.merchantId as merchantId'])
        .where('merchants.isActive', '=', true)
        .where('wizzy_configs.wizzyEnabled', '=', true)
        .where('wizzy_configs.autoSyncEnabled', '=', true)
        .execute();

      for (const { merchantId } of merchants) {
        try {
          await this.catalogSync.fullSync(merchantId, 'reconcile');
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
