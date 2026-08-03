import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { RedisService } from '../../../core/cache/redis.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';

/**
 * Midnight-IST snapshot into `loyalty_daily_stats`, one row per
 * (merchant, date).
 *
 * There is no Core event stream, so daily issued/redeemed/expired are derived
 * as DELTAS: today's mirror lifetime absolutes minus the sum of every prior
 * snapshot's delta. Each delta clamps at 0 (`max(0, …)`) so a mirror
 * correction can never produce a negative day. The write is INSERT…ODKU —
 * re-running a date overwrites the same row instead of duplicating it, and a
 * Redis `firstSeen` lock (26 h — covers the 24 h cadence plus drift) keeps
 * concurrent pods from double-running.
 */

/** Lock TTL: one day + slack so tomorrow's run gets a fresh key. */
const LOCK_TTL_SECONDS = 26 * 3600;
const IST_OFFSET = '+05:30';

/** The IST calendar day [start, end) for a `YYYY-MM-DD` date. */
function istDayRange(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00.000${IST_OFFSET}`);
  return [start, new Date(start.getTime() + 24 * 3600 * 1000)];
}

function num(value: unknown): number {
  return Number(value ?? 0) || 0;
}

@Injectable()
export class DailySnapshotJob {
  private readonly logger = new Logger(DailySnapshotJob.name);

  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly redis: RedisService,
  ) {}

  async runForDate(date: string): Promise<'locked' | 'done'> {
    if (!(await this.redis.firstSeen(`loyalty:snap:${date}`, LOCK_TTL_SECONDS))) {
      return 'locked';
    }

    const merchants = await this.handle.db
      .selectFrom('merchants')
      .select(['id'])
      .where('isActive', '=', true)
      .execute();

    for (const merchant of merchants) {
      try {
        await this.snapshotMerchant(merchant.id, date);
      } catch (err) {
        // One bad merchant must not sink the others; the row is recoverable
        // by re-running the date (ODKU) once the cause is fixed.
        this.logger.error({
          msg: 'daily snapshot failed for merchant',
          merchantId: merchant.id,
          date,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return 'done';
  }

  private async snapshotMerchant(merchantId: string, date: string): Promise<void> {
    const db = this.handle.db;
    const [dayStart, dayEnd] = istDayRange(date);

    // Mirror absolutes as of now.
    const absolutes = await db
      .selectFrom('loyalty_customers')
      .select((eb) => [
        eb.fn.sum<number>('lifetimeEarned').as('earned'),
        eb.fn.sum<number>('lifetimeRedeemed').as('redeemed'),
        eb.fn.sum<number>('lifetimeExpired').as('expired'),
        eb.fn.sum<number>('pointsBalance').as('outstanding'),
      ])
      .select(sql<number>`SUM(CASE WHEN points_balance > 0 THEN 1 ELSE 0 END)`.as('withBalance'))
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    // Everything already attributed to earlier snapshot days.
    const priors = await db
      .selectFrom('loyalty_daily_stats')
      .select((eb) => [
        eb.fn.sum<number>('pointsIssued').as('issued'),
        eb.fn.sum<number>('pointsRedeemed').as('redeemed'),
        eb.fn.sum<number>('pointsExpired').as('expired'),
      ])
      .where('merchantId', '=', merchantId)
      .where('statDate', '<', date)
      .executeTakeFirst();

    const pointsIssued = Math.max(0, num(absolutes?.earned) - num(priors?.issued));
    const pointsRedeemed = Math.max(0, num(absolutes?.redeemed) - num(priors?.redeemed));
    const pointsExpired = Math.max(0, num(absolutes?.expired) - num(priors?.expired));

    // App-attributed activity that happened ON this IST day.
    const bulkByType = await db
      .selectFrom('loyalty_bulk_operation_rows')
      .innerJoin(
        'loyalty_bulk_operations',
        'loyalty_bulk_operations.id',
        'loyalty_bulk_operation_rows.operationId',
      )
      .select(['loyalty_bulk_operations.type'])
      .select((eb) => eb.fn.sum<number>('loyalty_bulk_operation_rows.points').as('points'))
      .where('loyalty_bulk_operations.merchantId', '=', merchantId)
      .where('loyalty_bulk_operation_rows.status', '=', 'success')
      .where('loyalty_bulk_operation_rows.processedAt', '>=', dayStart)
      .where('loyalty_bulk_operation_rows.processedAt', '<', dayEnd)
      .groupBy('loyalty_bulk_operations.type')
      .execute();
    const bulkCredited = num(bulkByType.find((r) => r.type === 'credit')?.points);
    const bulkDebited = num(bulkByType.find((r) => r.type === 'debit')?.points);

    const qrAgg = await db
      .selectFrom('loyalty_qr_scans')
      .innerJoin('loyalty_qr_codes', 'loyalty_qr_codes.id', 'loyalty_qr_scans.qrCodeId')
      .select((eb) => eb.fn.sum<number>('loyalty_qr_codes.pointsPerScan').as('points'))
      .where('loyalty_qr_scans.merchantId', '=', merchantId)
      .where('loyalty_qr_scans.scannedAt', '>=', dayStart)
      .where('loyalty_qr_scans.scannedAt', '<', dayEnd)
      .executeTakeFirst();

    const ruleAgg = await db
      .selectFrom('loyalty_rule_applications')
      .select((eb) => eb.fn.sum<number>('extraPoints').as('points'))
      .where('merchantId', '=', merchantId)
      .where('appliedAt', '>=', dayStart)
      .where('appliedAt', '<', dayEnd)
      .executeTakeFirst();

    const metrics = {
      pointsIssued,
      pointsRedeemed,
      pointsExpired,
      bulkCredited,
      bulkDebited,
      qrPoints: num(qrAgg?.points),
      ruleExtraPoints: num(ruleAgg?.points),
      customersWithBalance: num(absolutes?.withBalance),
      outstandingPoints: num(absolutes?.outstanding),
    };

    await db
      .insertInto('loyalty_daily_stats')
      .values({ merchantId, statDate: date, ...metrics })
      .onDuplicateKeyUpdate({ ...metrics, updatedAt: sql<Date>`CURRENT_TIMESTAMP(3)` })
      .execute();
  }
}
