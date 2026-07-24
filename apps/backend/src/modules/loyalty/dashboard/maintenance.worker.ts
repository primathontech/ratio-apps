import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { CoreLoyaltyClient } from '../core-client/core-loyalty.client';
import type { LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { LOYALTY_CORE_CLIENT } from '../tokens';
import { DailySnapshotJob } from './daily-snapshot.job';

/**
 * Gated background loop (mirrors the wizzy sync-worker contract): runs only
 * when `LOYALTY_WORKER_ENABLED === 'true'`, one 60 s interval tick that
 *
 *   (a) sweeps ≤ {@link SWEEP_BATCH} stale mirror balances (never synced or
 *       > 24 h old) against live Core — per-row try/catch so one dead phone
 *       can't stall the sweep;
 *   (b) fires the previous IST day's snapshot the first tick after the IST
 *       date flips (the job's Redis lock makes concurrent pods safe).
 *
 * The interval is `unref()`ed so it never pins the process open, and cleared
 * on module destroy.
 */

const TICK_MS = 60_000;
const SWEEP_BATCH = 50;
const STALE_AFTER_MS = 24 * 3600 * 1000;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

function istDate(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function previousDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`) - 24 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

@Injectable()
export class MaintenanceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private lastIstDate = istDate();
  private ticking = false;

  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    @Inject(LOYALTY_CORE_CLIENT) private readonly core: CoreLoyaltyClient,
    private readonly snapshot: DailySnapshotJob,
  ) {}

  onModuleInit(): void {
    if (process.env.LOYALTY_WORKER_ENABLED !== 'true') {
      this.logger.log('LOYALTY_WORKER_ENABLED != true — maintenance worker disabled');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref();
    this.logger.log('maintenance worker started (60s tick)');
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One tick — overlap-guarded so a slow Core sweep can't stack ticks. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.sweepBalances();
      await this.maybeSnapshot();
    } catch (err) {
      this.logger.error({
        msg: 'maintenance tick failed',
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.ticking = false;
    }
  }

  private async sweepBalances(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const rows = await this.handle.db
      .selectFrom('loyalty_customers')
      .select(['merchantId', 'phone'])
      .where((eb) => eb.or([eb('balanceSyncedAt', 'is', null), eb('balanceSyncedAt', '<', cutoff)]))
      .orderBy('balanceSyncedAt', 'asc')
      .limit(SWEEP_BATCH)
      .execute();

    for (const row of rows) {
      try {
        const balance = await this.core.balance(row.merchantId, row.phone);
        await this.handle.db
          .updateTable('loyalty_customers')
          .set({
            pointsBalance: balance.points_balance,
            lifetimeEarned: balance.points_earned_lifetime,
            lifetimeRedeemed: balance.points_redeemed_lifetime,
            lifetimeExpired: balance.points_expired_lifetime,
            lifetimeAdjusted: balance.points_adjusted_lifetime,
            balanceSyncedAt: new Date(),
          })
          .where('merchantId', '=', row.merchantId)
          .where('phone', '=', row.phone)
          .execute();
      } catch {
        // Leave balanceSyncedAt as-is; the row is retried on a later sweep.
        this.logger.warn({ msg: 'balance sweep row failed', merchantId: row.merchantId });
      }
    }
  }

  private async maybeSnapshot(): Promise<void> {
    const today = istDate();
    if (today === this.lastIstDate) return;
    this.lastIstDate = today;
    await this.snapshot.runForDate(previousDate(today));
  }
}
