import { Inject, Injectable } from '@nestjs/common';
import type { LoyaltyQrState } from '@ratio-app/shared/schemas/loyalty-claim';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { LoyaltyConfigService } from '../config/config.service';
import type { LoyaltyDailyStatsRow, LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { qrStateFor } from '../qr/qr.service';

/**
 * Dashboard reads. Tiles + trend come from `loyalty_daily_stats` (a bounded
 * ≤366-row range fetch summed in memory — snapshot granularity is daily, so
 * there is nothing big to aggregate); rule/QR tables aggregate their activity
 * tables in SQL.
 */

export interface StatsSummary {
  pointsIssued: number;
  pointsRedeemed: number;
  pointsExpired: number;
  /** redeemed / issued, one decimal, percent (0 when nothing issued). */
  redemptionRate: number;
  customersWithBalance: number;
  outstandingPoints: number;
  /** outstanding × coinValueInr, two decimals. */
  liabilityInr: number;
}

export interface TrendPoint {
  date: string;
  pointsIssued: number;
  pointsRedeemed: number;
  pointsExpired: number;
}

const DAY_MS = 24 * 3600 * 1000;
/** Fallback coin value when the merchant has no config row (schema default). */
const DEFAULT_COIN_VALUE_INR = 0.1;

function dateKey(value: Date | string): string {
  if (value instanceof Date) {
    // MySQL DATE comes back as a local-midnight Date — format locally so an
    // IST runtime doesn't shift the day via toISOString (UTC−5:30).
    const y = value.getFullYear();
    const m = `${value.getMonth() + 1}`.padStart(2, '0');
    const d = `${value.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

@Injectable()
export class StatsService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly config: LoyaltyConfigService,
  ) {}

  async summary(merchantId: string, from: string, to: string): Promise<StatsSummary> {
    const rows = await this.statsRows(merchantId, from, to);
    const issued = sum(rows, (r) => r.pointsIssued);
    const redeemed = sum(rows, (r) => r.pointsRedeemed);
    const expired = sum(rows, (r) => r.pointsExpired);
    const latest = rows.at(-1); // range-ordered asc → last = latest snapshot
    const outstanding = latest ? Number(latest.outstandingPoints) : 0;

    let coinValue = DEFAULT_COIN_VALUE_INR;
    try {
      coinValue = (await this.config.getByMerchantId(merchantId)).coinValueInr;
    } catch {
      /* no config row yet — schema default */
    }

    return {
      pointsIssued: issued,
      pointsRedeemed: redeemed,
      pointsExpired: expired,
      redemptionRate: pct(redeemed, issued),
      customersWithBalance: latest ? Number(latest.customersWithBalance) : 0,
      outstandingPoints: outstanding,
      liabilityInr: Math.round(outstanding * coinValue * 100) / 100,
    };
  }

  /** Per-day issued/redeemed series, zero-filled across the whole range. */
  async trend(merchantId: string, from: string, to: string): Promise<TrendPoint[]> {
    const rows = await this.statsRows(merchantId, from, to);
    const byDate = new Map(rows.map((r) => [dateKey(r.statDate), r]));

    const series: TrendPoint[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); ; t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (date > to) break;
      const row = byDate.get(date);
      series.push({
        date,
        pointsIssued: row ? Number(row.pointsIssued) : 0,
        pointsRedeemed: row ? Number(row.pointsRedeemed) : 0,
        pointsExpired: row ? Number(row.pointsExpired) : 0,
      });
    }
    return series;
  }

  /** Per-rule performance: matches, extra coins, unique customers. */
  async rulesTable(merchantId: string): Promise<
    {
      id: string;
      name: string;
      ruleType: string;
      active: boolean;
      matches: number;
      extraCoins: number;
      uniqueCustomers: number;
    }[]
  > {
    const [rules, aggs] = await Promise.all([
      this.handle.db
        .selectFrom('loyalty_rules')
        .selectAll()
        .where('merchantId', '=', merchantId)
        .orderBy('createdAt', 'desc')
        .execute(),
      this.handle.db
        .selectFrom('loyalty_rule_applications')
        .select(['ruleId'])
        .select((eb) => [
          eb.fn.countAll<number>().as('matches'),
          eb.fn.sum<number>('extraPoints').as('extraCoins'),
        ])
        .select(sql<number>`COUNT(DISTINCT phone)`.as('uniqueCustomers'))
        .where('merchantId', '=', merchantId)
        .groupBy('ruleId')
        .execute(),
    ]);
    const byRule = new Map(aggs.map((a) => [a.ruleId, a]));
    return rules.map((rule) => {
      const agg = byRule.get(rule.id);
      return {
        id: rule.id,
        name: rule.name,
        ruleType: rule.ruleType,
        active: Boolean(rule.active),
        matches: Number(agg?.matches ?? 0),
        extraCoins: Number(agg?.extraCoins ?? 0),
        uniqueCustomers: Number(agg?.uniqueCustomers ?? 0),
      };
    });
  }

  /** Per-QR performance including conversion-to-order count + rate. */
  async qrTable(merchantId: string): Promise<
    {
      id: string;
      code: string;
      eventName: string;
      state: LoyaltyQrState;
      scanCount: number;
      newPhoneCount: number;
      converted: number;
      conversionRate: number;
    }[]
  > {
    const [qrs, conversions] = await Promise.all([
      this.handle.db
        .selectFrom('loyalty_qr_codes')
        .selectAll()
        .where('merchantId', '=', merchantId)
        .orderBy('createdAt', 'desc')
        .execute(),
      this.handle.db
        .selectFrom('loyalty_qr_scans')
        .select(['qrCodeId'])
        .select((eb) => eb.fn.countAll<number>().as('converted'))
        .where('merchantId', '=', merchantId)
        .where('convertedOrderId', 'is not', null)
        .groupBy('qrCodeId')
        .execute(),
    ]);
    const byQr = new Map(conversions.map((c) => [c.qrCodeId, Number(c.converted)]));
    return qrs.map((qr) => {
      const scans = Number(qr.scanCount);
      const converted = byQr.get(qr.id) ?? 0;
      return {
        id: qr.id,
        code: qr.code,
        eventName: qr.eventName,
        state: qrStateFor(qr),
        scanCount: scans,
        newPhoneCount: Number(qr.newPhoneCount),
        converted,
        conversionRate: pct(converted, scans),
      };
    });
  }

  /** Bulk-ops summary over the range: coins moved + operations run. */
  async bulkSummary(
    merchantId: string,
    from: string,
    to: string,
  ): Promise<{ bulkCredited: number; bulkDebited: number; operations: number }> {
    const rows = await this.statsRows(merchantId, from, to);
    const opsRow = await this.handle.db
      .selectFrom('loyalty_bulk_operations')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('merchantId', '=', merchantId)
      .where('createdAt', '>=', new Date(`${from}T00:00:00.000Z`))
      .where('createdAt', '<=', new Date(`${to}T23:59:59.999Z`))
      .executeTakeFirst();
    return {
      bulkCredited: sum(rows, (r) => r.bulkCredited),
      bulkDebited: sum(rows, (r) => r.bulkDebited),
      operations: Number((opsRow as { total?: unknown } | undefined)?.total ?? 0),
    };
  }

  private statsRows(merchantId: string, from: string, to: string): Promise<LoyaltyDailyStatsRow[]> {
    return this.handle.db
      .selectFrom('loyalty_daily_stats')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('statDate', '>=', from)
      .where('statDate', '<=', to)
      .orderBy('statDate', 'asc')
      .execute();
  }
}

function sum(rows: LoyaltyDailyStatsRow[], pick: (r: LoyaltyDailyStatsRow) => unknown): number {
  return rows.reduce((acc, row) => acc + Number(pick(row) ?? 0), 0);
}
