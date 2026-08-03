import { beforeEach, describe, expect, it } from 'vitest';
import type { RedisService } from '../../../../src/core/cache/redis.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { DailySnapshotJob } from '../../../../src/modules/loyalty/dashboard/daily-snapshot.job';
import type { LoyaltyDatabase } from '../../../../src/modules/loyalty/db/types';
import { FakeRedis, MERCHANT_ID } from './helpers/fakes';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;

/**
 * Canned-aggregate chain fake: the snapshot job's reads are all one-shot
 * aggregate queries, so each table maps to a fixed result set. Inserts into
 * `loyalty_daily_stats` are captured and ODKU-merged on (merchantId, statDate)
 * like MySQL would.
 */
function makeSnapshotDb(canned: Record<string, Row[]>) {
  const inserts: { values: Row; odku: Row | null }[] = [];
  const statsTable: Row[] = [];

  const db: any = {
    selectFrom(table: string) {
      const chain: any = {
        select: () => chain,
        selectAll: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        groupBy: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        execute: () => Promise.resolve(canned[table] ?? []),
        executeTakeFirst: () => Promise.resolve((canned[table] ?? [])[0]),
      };
      return chain;
    },
    insertInto(table: string) {
      if (table !== 'loyalty_daily_stats') throw new Error(`unexpected insert into ${table}`);
      let vals: Row = {};
      let odku: Row | null = null;
      const chain: any = {
        values: (v: Row) => {
          vals = v;
          return chain;
        },
        onDuplicateKeyUpdate: (u: Row) => {
          odku = u;
          return chain;
        },
        execute: () => {
          inserts.push({ values: vals, odku });
          const existing = statsTable.find(
            (r) => r.merchantId === vals.merchantId && r.statDate === vals.statDate,
          );
          if (existing) {
            if (!odku) throw new Error('duplicate key without ODKU');
            Object.assign(existing, odku);
          } else {
            statsTable.push({ ...vals });
          }
          return Promise.resolve([]);
        },
      };
      return chain;
    },
  };

  const handle = { db, close: () => Promise.resolve() } as unknown as KyselyClient<LoyaltyDatabase>;
  return { handle, inserts, statsTable };
}

const DATE = '2026-07-19';

function cannedActivity(): Record<string, Row[]> {
  return {
    merchants: [{ id: MERCHANT_ID }],
    loyalty_customers: [
      { earned: 100, redeemed: 50, expired: 5, outstanding: 500, withBalance: 3 },
    ],
    loyalty_daily_stats: [{ issued: 120, redeemed: 20, expired: 0 }],
    loyalty_bulk_operation_rows: [
      { type: 'credit', points: 40 },
      { type: 'debit', points: 10 },
    ],
    loyalty_qr_scans: [{ points: 25 }],
    loyalty_rule_applications: [{ points: 15 }],
  };
}

describe('DailySnapshotJob', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  it('#writes-daily-row — deltas vs priors with a max(0) clamp', async () => {
    const { handle, inserts } = makeSnapshotDb(cannedActivity());
    const job = new DailySnapshotJob(handle, redis as unknown as RedisService);

    const res = await job.runForDate(DATE);

    expect(res).toBe('done');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      merchantId: MERCHANT_ID,
      statDate: DATE,
      pointsIssued: 0, // max(0, 100 − 120) — prior overshoot clamps, never negative
      pointsRedeemed: 30, // 50 − 20
      pointsExpired: 5, // 5 − 0
      bulkCredited: 40,
      bulkDebited: 10,
      qrPoints: 25,
      ruleExtraPoints: 15,
      customersWithBalance: 3,
      outstandingPoints: 500,
    });
  });

  it('handles NULL aggregates (empty tables) as zeroes', async () => {
    const { handle, inserts } = makeSnapshotDb({
      merchants: [{ id: MERCHANT_ID }],
      loyalty_customers: [
        { earned: null, redeemed: null, expired: null, outstanding: null, withBalance: null },
      ],
      loyalty_daily_stats: [{ issued: null, redeemed: null, expired: null }],
      loyalty_bulk_operation_rows: [],
      loyalty_qr_scans: [{ points: null }],
      loyalty_rule_applications: [{ points: null }],
    });
    const job = new DailySnapshotJob(handle, redis as unknown as RedisService);

    await job.runForDate(DATE);

    expect(inserts[0].values).toMatchObject({
      pointsIssued: 0,
      pointsRedeemed: 0,
      pointsExpired: 0,
      bulkCredited: 0,
      bulkDebited: 0,
      qrPoints: 0,
      ruleExtraPoints: 0,
      customersWithBalance: 0,
      outstandingPoints: 0,
    });
  });

  it('#redis-lock-prevents-double-run — firstSeen false skips entirely', async () => {
    const { handle, inserts } = makeSnapshotDb(cannedActivity());
    const job = new DailySnapshotJob(handle, redis as unknown as RedisService);

    expect(await job.runForDate(DATE)).toBe('done');
    // Same date again on the same lock: firstSeen returns false → locked.
    expect(await job.runForDate(DATE)).toBe('locked');
    expect(inserts).toHaveLength(1);
  });

  it('re-run after lock expiry is an idempotent upsert (ODKU), not a duplicate', async () => {
    const { handle, inserts, statsTable } = makeSnapshotDb(cannedActivity());
    const job = new DailySnapshotJob(handle, redis as unknown as RedisService);

    await job.runForDate(DATE);
    redis.store.delete(`seen:loyalty:snap:${DATE}`); // lock TTL elapsed
    await job.runForDate(DATE);

    expect(inserts).toHaveLength(2);
    expect(inserts[1].odku).not.toBeNull(); // second write carried ODKU
    expect(statsTable).toHaveLength(1); // still one row for (merchant, date)
    expect(statsTable[0]).toMatchObject({ merchantId: MERCHANT_ID, statDate: DATE });
  });
});
