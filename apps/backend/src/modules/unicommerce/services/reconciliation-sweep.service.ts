import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { SingleRunnerGuard } from '../../../core/scheduling/single-runner';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { buildOrderPushJobPayload, type RatioOrderPayload } from '../webhooks/order-confirmed.handler';
import { isDuplicateKeyError } from './duplicate-key.util';
import {
  classifyRatioOrder,
  isIdle,
  isTerminalStage,
  type OrderStage,
} from './order-stage-mapping';
import { UcOrderItemMapService } from './order-item-map.service';
import { UcRatioApiService } from './uc-ratio-api.service';
import { UcSyncQueueService } from './sync-queue.service';

/**
 * Statuses `uc_sync_jobs.status` can hold. `PENDING`/`RETRYING`/`NEEDS_MANUAL`
 * are all "not yet done, safe to re-nudge"; `IN_PROGRESS` means a worker may
 * be mid-push right now (reclaiming a stuck one is a separate, already-
 * documented gap — TRD §8 — this sweep must not touch it); `DONE` is the
 * only genuinely-synced terminal state.
 */
const RETRYABLE_STATUSES = new Set(['PENDING', 'RETRYING', 'NEEDS_MANUAL']);

// TRD §5.1: how far back each automatic cycle re-scans. Kept wider than the
// 10-minute cron interval itself so a slow cycle (or a missed tick) still
// gets full overlap coverage on the next run, without re-diffing the entire
// order history every time.
const SWEEP_WINDOW_MS = 30 * 60 * 1000;

// Canary first-run fallback: when a merchant has no prior COMPLETED
// reconciliation job yet, the first canary window starts 15 days back rather
// than trying to walk the whole order history.
const CANARY_FIRST_RUN_LOOKBACK_MS = 15 * 24 * 60 * 60 * 1000;

// Goal 2 alert pass lookback: only non-terminal Ratio orders created within
// the last 90 days are evaluated for stage-idleness.
const STALE_ORDER_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

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
 * Every 30 minutes a lightweight canary tick (`canaryTick`) replaces the
 * full diff: it compares two cheap counts over a dynamic window derived from
 * the last COMPLETED job's `time_range_end` (Ratio orders vs. `uc_sync_jobs`
 * order_push rows) and only falls through to the full `run()` diff on a
 * mismatch — a match still records a COMPLETED row so the window keeps
 * advancing. The same tick then runs the stage-aware stale-order alert pass
 * (moved here from `UcAlertingService`'s flat-threshold Signal A): every
 * non-terminal Ratio order created in the last 90 days is classified via
 * `order-stage-mapping.ts` and flagged `STALE_ORDER` once idle past its
 * stage threshold.
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
    private readonly orderItemMap: UcOrderItemMapService,
    private readonly syncQueue: UcSyncQueueService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async everyTenMinutes(): Promise<void> {
    await this.runReconcileCycle();
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async everyThirtyMinutes(): Promise<void> {
    await this.runCanaryCycle();
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
   * Run one canary cycle over every active merchant. Skips if a sweep/cycle
   * is already running — the same single-runner guard as the 10-minute
   * cycle, so the canary never double-pushes orders while the full sweep is
   * mid-run on this pod (the per-merchant RUNNING-row check in `canaryTick`
   * additionally protects against manual runs and other pods).
   */
  async runCanaryCycle(): Promise<{ ran: boolean; merchants: number }> {
    return this.guard.run(
      async (): Promise<{ ran: boolean; merchants: number }> => {
        const merchants = await this.handle.db
          .selectFrom('ucCredentials')
          .select('merchantId')
          .where('status', '=', 'active')
          .execute();

        for (const { merchantId } of merchants) {
          try {
            await this.canaryTick(merchantId);
          } catch (err) {
            this.logger.error({
              msg: 'reconciliation canary failed for merchant',
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
   * One lightweight canary tick for a single merchant: a cheap windowed count
   * comparison (Ratio orders vs. `uc_sync_jobs` order_push rows) that falls
   * through to the full per-order `run()` diff only when the counts disagree,
   * followed by the stage-aware stale-order alert pass (moved here from
   * `UcAlertingService`'s flat-threshold Signal A).
   *
   * The dynamic window advances off the last COMPLETED job's `time_range_end`
   * — which is exactly why the match path below still writes a COMPLETED row:
   * without it the window would never move and every tick would re-compare
   * the same slice forever.
   */
  async canaryTick(merchantId: string): Promise<void> {
    // Overlap guard: a RUNNING reconciliation row (from the 10-minute sweep,
    // a manual run, or a previous canary tick that's still going) means this
    // merchant is already being diffed — skip rather than start a second
    // concurrent run for the same merchant.
    const running = await this.handle.db
      .selectFrom('ucReconciliationJobs')
      .select('id')
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'RUNNING')
      .executeTakeFirst();
    if (running) {
      this.logger.log({
        msg: 'reconciliation canary: skipping merchant, a reconciliation job is already RUNNING',
        merchantId,
      });
      return;
    }

    const end = new Date();
    const lastCompleted = await this.handle.db
      .selectFrom('ucReconciliationJobs')
      .select('timeRangeEnd')
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'COMPLETED')
      .orderBy('completedAt', 'desc')
      .executeTakeFirst();
    const start =
      lastCompleted?.timeRangeEnd ?? new Date(end.getTime() - CANARY_FIRST_RUN_LOOKBACK_MS);

    const ratioOrderCount = await this.countRatioOrders(merchantId, start, end);
    const syncJobCount = await this.countOrderPushJobs(merchantId, start, end);

    if (ratioOrderCount !== syncJobCount) {
      // Cheap check says the window isn't in sync — fall through to the full
      // per-order diff-and-push (`run()`), recording the usual RUNNING →
      // COMPLETED audit row via `runForMerchant` just like the 10-minute
      // cycle does.
      await this.runForMerchant(merchantId, start, end, 'system');
      this.logger.warn({
        msg: 'reconciliation canary: windowed counts differ, full diff-run executed',
        merchantId,
        timeRangeStart: start.toISOString(),
        timeRangeEnd: end.toISOString(),
        ratioOrderCount,
        syncJobCount,
      });
    } else {
      // No-op diff, but still record a COMPLETED row so the NEXT tick's
      // dynamic-window lookup has a fresh `time_range_end` to build from.
      await this.handle.db
        .insertInto('ucReconciliationJobs')
        .values({
          id: randomUUID(),
          merchantId,
          requestedBy: 'system',
          timeRangeStart: start,
          timeRangeEnd: end,
          status: 'COMPLETED',
          ordersCheckedCount: ratioOrderCount,
          ordersPushedCount: 0,
          ordersAlreadySyncedCount: ratioOrderCount,
          ordersFailedCount: 0,
          completedAt: new Date(),
        })
        .execute();
    }

    // Goal 2 — stage-aware alert pass, on a SEPARATE wider pull (90 days of
    // non-terminal orders), regardless of what the canary's count check found.
    await this.checkStaleRatioOrders(merchantId);
  }

  /** Cheap existence check, side A: count Ratio orders in the window (same paged `listOrders` call `run()` uses — no per-order diff). */
  private async countRatioOrders(merchantId: string, start: Date, end: Date): Promise<number> {
    let count = 0;
    let page = 1;
    for (;;) {
      const orders = await this.ratio.listOrders(merchantId, {
        page,
        pageSize: 50,
        orderDateFrom: start.toISOString(),
        orderDateTo: end.toISOString(),
      });
      if (orders.length === 0) break;
      count += orders.length;
      if (orders.length < 50) break;
      page++;
    }
    return count;
  }

  /** Cheap existence check, side B: count `uc_sync_jobs` order_push rows created in the same window. */
  private async countOrderPushJobs(merchantId: string, start: Date, end: Date): Promise<number> {
    const counted = await this.handle.db
      .selectFrom('ucSyncJobs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('merchantId', '=', merchantId)
      .where('type', '=', 'order_push')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .executeTakeFirst();
    return Number(counted?.count ?? 0);
  }

  /**
   * Stage-aware stale-order alert pass (the replacement for
   * `UcAlertingService`'s flat 48h Signal A, TRD §5.2): pulls every
   * non-terminal Ratio order created in the last 90 days, classifies it via
   * `order-stage-mapping.ts`, and raises a `STALE_ORDER` alert when it has
   * been idle in its current stage past the stage's threshold. Same dedup as
   * the old check — one unacknowledged alert per (merchant, ratio order) — so
   * a detection that keeps re-firing doesn't spam a fresh row every 30
   * minutes.
   */
  private async checkStaleRatioOrders(merchantId: string): Promise<number> {
    const now = new Date();
    const lookback = new Date(now.getTime() - STALE_ORDER_LOOKBACK_MS);

    let created = 0;
    let page = 1;
    for (;;) {
      const orders = await this.ratio.listOrders(merchantId, {
        page,
        pageSize: 50,
        orderDateFrom: lookback.toISOString(),
        orderDateTo: now.toISOString(),
      });
      if (orders.length === 0) break;

      for (const order of orders) {
        const stage = classifyRatioOrder(order as { status?: string; fulfillment_status?: string });
        if (isTerminalStage(stage)) continue;

        const ratioOrderId = (order.id ?? order.order_id ?? '') as string;
        if (!ratioOrderId) continue;

        const stageEnteredAt = await this.resolveStageEnteredAt(order, merchantId, ratioOrderId, stage);
        if (!isIdle(stage, stageEnteredAt, now)) continue;

        const existing = await this.handle.db
          .selectFrom('ucAlerts')
          .select('id')
          .where('merchantId', '=', merchantId)
          .where('type', '=', 'STALE_ORDER')
          .where('reference', '=', ratioOrderId)
          .where('acknowledgedAt', 'is', null)
          .executeTakeFirst();
        if (existing) continue;

        await this.handle.db
          .insertInto('ucAlerts')
          .values({ merchantId, type: 'STALE_ORDER', reference: ratioOrderId })
          .execute();
        created++;
        this.logger.warn({
          msg: 'alert: order idle in its current stage past the stage threshold',
          merchantId,
          ratioOrderId,
          stage,
          stageEnteredAt: stageEnteredAt.toISOString(),
        });
      }

      if (orders.length < 50) break;
      page++;
    }
    return created;
  }

  /**
   * When did this order enter its current stage?
   *
   * CREATED stages clock from the order's own `created_at`; every other
   * non-terminal stage prefers the order's own `updated_at` (a confirmed
   * field on Ratio order objects — see orders-read.controller.ts's bulkPull
   * example). Orders missing that field on the object fall back to the
   * `uc_order_item_map` proxy (`last_status_updated_at`, else `created_at`)
   * so the idle clock still has a datum to run from. Returns an Invalid Date
   * when nothing usable exists — `isIdle()` treats that as not-idle (NaN is
   * never > threshold), i.e. fail closed, never alert on an order whose age
   * we genuinely can't determine.
   */
  private async resolveStageEnteredAt(
    order: Record<string, unknown>,
    merchantId: string,
    ratioOrderId: string,
    stage: OrderStage,
  ): Promise<Date> {
    const primary = stage === 'CREATED' ? order.created_at : order.updated_at;
    const parsed = typeof primary === 'string' ? new Date(primary) : new Date(Number.NaN);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    const mapRow = await this.handle.db
      .selectFrom('ucOrderItemMap')
      .select(['lastStatusUpdatedAt', 'createdAt'])
      .where('merchantId', '=', merchantId)
      .where('ratioOrderId', '=', ratioOrderId)
      .executeTakeFirst();
    const proxy = mapRow?.lastStatusUpdatedAt ?? mapRow?.createdAt;
    return proxy ?? parsed;
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
          .select(['id', 'status'])
          .where('merchantId', '=', merchantId)
          .where('ratioOrderId', '=', ratioOrderId)
          .where('type', '=', 'order_push')
          .executeTakeFirst();

        if (!existing) {
          // An order cancelled on Ratio before it was ever pushed to UC
          // (app installed late, webhook outage, ...) must not be enqueued
          // as if it were still live and fulfillable — skip it entirely so
          // it falls into none of the three counters. Same field/value as
          // the status mapping in orders-read.controller.ts.
          if (order.status === 'cancelled') {
            this.logger.log({
              msg: 'reconciliation: skipping already-cancelled order, never pushed to UC',
              merchantId,
              ratioOrderId,
            });
          } else {
            try {
              await this.enqueueAndPublish(merchantId, ratioOrderId, order);
              result.ordersPushedCount++;
            } catch (err) {
              if (isDuplicateKeyError(err)) {
                // Lost a race against another writer (the webhook handler,
                // or a second sweep) that inserted this exact
                // (merchant, order, type) row a moment ago — not a failure,
                // the order is already being handled.
                result.ordersAlreadySyncedCount++;
              } else {
                this.logger.error({
                  msg: 'reconciliation: failed to enqueue missing order',
                  merchantId,
                  ratioOrderId,
                  err: err instanceof Error ? err.message : String(err),
                });
                result.ordersFailedCount++;
              }
            }
          }
        } else if (existing.status === 'DONE') {
          result.ordersAlreadySyncedCount++;
        } else if (RETRYABLE_STATUSES.has(existing.status)) {
          // Catches the case a webhook-only recovery path can't: the job
          // was enqueued but its Kafka publish failed (or was never
          // consumed), so it's sat PENDING/RETRYING/NEEDS_MANUAL with
          // nothing ever nudging it again. Re-publish the SAME job — do
          // not insert a second row.
          await this.syncQueue.publish(existing.id, {
            merchantId,
            type: 'order_push',
            ratioOrderId,
          });
          result.ordersPushedCount++;
        }
        // else: IN_PROGRESS (or any other/future status) — a worker may be
        // mid-push right now; touching it risks a genuine double-push, and
        // reclaiming a truly stuck IN_PROGRESS job is a separate,
        // already-documented gap (TRD §8). Leave it alone, no counter.
      }

      if (orders.length < 50) break;
      page++;
    }

    return result;
  }

  // Builds the exact same UC-contract payload the `orders/create` webhook
  // handler does (shared via `buildOrderPushJobPayload` — item-map rows,
  // IST dates, paisa→rupee prices, addresses), inserts the job row, and
  // publishes it. Kept as one method so `run()`'s per-order branches read
  // as ONE happy path plus otherwise-flat status branches.
  private async enqueueAndPublish(
    merchantId: string,
    ratioOrderId: string,
    order: Record<string, unknown>,
  ): Promise<void> {
    const payload = await buildOrderPushJobPayload(
      this.orderItemMap,
      merchantId,
      order as unknown as RatioOrderPayload,
    );
    const jobId = randomUUID();
    await this.handle.db
      .insertInto('ucSyncJobs')
      .values({
        id: jobId,
        merchantId,
        type: 'order_push',
        ratioOrderId,
        payload: JSON.stringify(payload) as unknown as Record<string, unknown>,
        status: 'PENDING',
      })
      .execute();
    await this.syncQueue.publish(jobId, { merchantId, type: 'order_push', ratioOrderId });
  }
}
