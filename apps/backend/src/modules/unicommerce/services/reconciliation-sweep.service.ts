import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { SingleRunnerGuard } from '../../../core/scheduling/single-runner';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UcRatioApiService } from './uc-ratio-api.service';

// TRD §5.1: how far back each automatic cycle re-scans. Kept wider than the
// 10-minute cron interval itself so a slow cycle (or a missed tick) still
// gets full overlap coverage on the next run, without re-diffing the entire
// order history every time.
const SWEEP_WINDOW_MS = 30 * 60 * 1000;

export interface SweepResult {
  ordersCheckedCount: number;
  ordersPushedCount: number;
  ordersAlreadySyncedCount: number;
  ordersFailedCount: number;
}

export interface ReconciliationJob {
  id: string;
  merchantId: string;
  requestedBy: 'system' | 'manual';
  timeRangeStart: Date;
  timeRangeEnd: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  ordersCheckedCount: number;
  ordersPushedCount: number;
  ordersAlreadySyncedCount: number;
  ordersFailedCount: number;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * Reconciliation sweep for the Unicommerce connector (TRD §5.1): re-scans
 * Ratio's own Orders API for a time window and compares each order's
 * existence in `uc_sync_jobs` (type='order_push') — an order pushed to UC
 * only via a webhook that never actually reached us (app was down, etc.)
 * has no row there and gets a fresh `order_push` job enqueued.
 *
 * Runs automatically every 10 minutes for every merchant with active
 * credentials (single-runner guard — TRD's cron cadence, same `running`
 * pattern as `google`/`wizzy`'s `reconcile.service.ts`), and can also be
 * triggered manually per merchant (Admin UI's Manual Reconciliation panel,
 * §7) via `runForMerchant` directly with `requestedBy: 'manual'`.
 *
 * Each run is recorded as a `uc_reconciliation_jobs` row so both the
 * automatic cycle and manual triggers are visible/auditable in one place.
 */
@Injectable()
export class UcReconciliationSweepService {
  private readonly logger = new Logger(UcReconciliationSweepService.name);
  private readonly guard = new SingleRunnerGuard(this.logger, 'reconciliation sweep');

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    private readonly ratio: UcRatioApiService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async everyTenMinutes(): Promise<void> {
    await this.runReconcileCycle();
  }

  /** Run one automatic sweep cycle over every active merchant. Skips if already running. */
  async runReconcileCycle(): Promise<{ ran: boolean; merchants: number }> {
    return this.guard.run(
      async (): Promise<{ ran: boolean; merchants: number }> => {
        const merchants = await this.handle.db
          .selectFrom('ucCredentials')
          .select('merchantId')
          .where('status', '=', 'active')
          .execute();

        const end = new Date();
        const start = new Date(end.getTime() - SWEEP_WINDOW_MS);

        for (const { merchantId } of merchants) {
          try {
            await this.runForMerchant(merchantId, start, end, 'system');
          } catch (err) {
            this.logger.error({
              msg: 'reconciliation sweep failed for merchant',
              merchantId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return { ran: true, merchants: merchants.length };
      },
      { ran: false, merchants: 0 },
    );
  }

  /**
   * Run and record one reconciliation job for a single merchant, awaiting
   * the full sweep before returning — used by the automatic cron cycle,
   * which has no client waiting on a response.
   */
  async runForMerchant(
    merchantId: string,
    start: Date,
    end: Date,
    requestedBy: 'system' | 'manual',
  ): Promise<string> {
    const jobId = await this.insertJobRow(merchantId, start, end, requestedBy);
    try {
      const result = await this.run(merchantId, start, end);
      await this.completeJobRow(jobId, result);
    } catch (err) {
      await this.failJobRow(jobId);
      throw err;
    }
    return jobId;
  }

  /**
   * Admin UI's Manual Reconciliation panel (§7): records the job row and
   * returns its id immediately (202-style) without waiting for the sweep
   * itself, which can take a while for a large range — the SPA polls
   * `getJob` for progress/results instead.
   */
  async triggerManual(merchantId: string, start: Date, end: Date): Promise<string> {
    const jobId = await this.insertJobRow(merchantId, start, end, 'manual');
    this.run(merchantId, start, end)
      .then((result) => this.completeJobRow(jobId, result))
      .catch(() => this.failJobRow(jobId));
    return jobId;
  }

  async getJob(jobId: string): Promise<ReconciliationJob | null> {
    const row = await this.handle.db
      .selectFrom('ucReconciliationJobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirst();
    return row ?? null;
  }

  private async insertJobRow(
    merchantId: string,
    start: Date,
    end: Date,
    requestedBy: 'system' | 'manual',
  ): Promise<string> {
    const jobId = randomUUID();
    await this.handle.db
      .insertInto('ucReconciliationJobs')
      .values({
        id: jobId,
        merchantId,
        requestedBy,
        timeRangeStart: start,
        timeRangeEnd: end,
        status: 'RUNNING',
        ordersCheckedCount: 0,
        ordersPushedCount: 0,
        ordersAlreadySyncedCount: 0,
        ordersFailedCount: 0,
      })
      .execute();
    return jobId;
  }

  private async completeJobRow(jobId: string, result: SweepResult): Promise<void> {
    await this.handle.db
      .updateTable('ucReconciliationJobs')
      .set({
        status: 'COMPLETED',
        ordersCheckedCount: result.ordersCheckedCount,
        ordersPushedCount: result.ordersPushedCount,
        ordersAlreadySyncedCount: result.ordersAlreadySyncedCount,
        ordersFailedCount: result.ordersFailedCount,
        completedAt: new Date(),
      })
      .where('id', '=', jobId)
      .execute();
  }

  private async failJobRow(jobId: string): Promise<void> {
    await this.handle.db
      .updateTable('ucReconciliationJobs')
      .set({ status: 'FAILED', completedAt: new Date() })
      .where('id', '=', jobId)
      .execute();
  }

  /**
   * Walk Ratio's orders in the window and enqueue an `order_push` job for
   * any order with no existing `uc_sync_jobs` row — the case where the
   * original `orders/create` webhook never actually reached us.
   */
  async run(merchantId: string, start: Date, end: Date): Promise<SweepResult> {
    const result: SweepResult = {
      ordersCheckedCount: 0,
      ordersPushedCount: 0,
      ordersAlreadySyncedCount: 0,
      ordersFailedCount: 0,
    };

    let page = 1;
    for (;;) {
      const orders = await this.ratio.listOrders(merchantId, {
        page,
        pageSize: 50,
        orderDateFrom: start.toISOString(),
        orderDateTo: end.toISOString(),
      });
      if (orders.length === 0) break;

      for (const order of orders) {
        result.ordersCheckedCount++;
        const ratioOrderId = (order.id ?? order.order_id ?? '') as string;
        if (!ratioOrderId) continue;

        const existing = await this.handle.db
          .selectFrom('ucSyncJobs')
          .select('id')
          .where('merchantId', '=', merchantId)
          .where('ratioOrderId', '=', ratioOrderId)
          .where('type', '=', 'order_push')
          .executeTakeFirst();

        if (!existing) {
          try {
            await this.handle.db
              .insertInto('ucSyncJobs')
              .values({
                merchantId,
                type: 'order_push',
                ratioOrderId,
                payload: order as Record<string, unknown>,
                status: 'PENDING',
              })
              .execute();
            result.ordersPushedCount++;
          } catch (err) {
            this.logger.error({
              msg: 'reconciliation: failed to enqueue missing order',
              merchantId,
              ratioOrderId,
              err: err instanceof Error ? err.message : String(err),
            });
            result.ordersFailedCount++;
          }
        } else {
          result.ordersAlreadySyncedCount++;
        }
      }

      if (orders.length < 50) break;
      page++;
    }

    return result;
  }
}
