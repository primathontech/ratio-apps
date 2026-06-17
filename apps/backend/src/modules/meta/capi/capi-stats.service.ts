import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { MetaDatabase } from '../db/types';
import { META_DB_TOKEN } from '../kysely.module';

/** One day's delivery counters, normalized to numbers (mysql2 returns BIGINT as string). */
export interface DailyStat {
  day: string; // YYYY-MM-DD (UTC)
  batches: number;
  dispatched: number;
  failed: number;
}

/** Bounded failure classification — keeps the breakdown's cardinality small. */
export type FailureReason =
  | 'rate_limited'
  | 'invalid_request'
  | 'auth'
  | 'timeout'
  | 'server_error'
  | 'unknown';

export interface FailureBreakdown {
  reason: FailureReason;
  events: number;
  lastMessage: string; // one real example of the underlying error
}

export interface StatsSummary {
  /** Per-day rows, newest first. */
  daily: DailyStat[];
  totals: { batches: number; dispatched: number; failed: number };
  /**
   * dispatched / (dispatched + failed), 0–1, rounded to 4dp. null when there
   * were no delivery attempts (avoids a misleading 0% or NaN). Note: `failed`
   * attempts are retried, so this is a first-attempt success rate, not 1−loss.
   */
  successRate: number | null;
  /** Why events failed, summed per reason over the window (most events first). */
  failures: FailureBreakdown[];
}

/**
 * Map a raw Meta/transport error message to a bounded reason code. Checked
 * most-specific first (429 before the generic 4xx; timeout/auth before 4xx).
 */
export function classifyCapiError(message: string): FailureReason {
  const m = (message || '').toLowerCase();
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many')) return 'rate_limited';
  if (m.includes('timeout') || m.includes('aborted')) return 'timeout';
  if (m.includes('401') || m.includes('403') || m.includes('token') || m.includes('oauth') || m.includes('permission')) return 'auth';
  if (/meta capi 4\d\d/.test(m) || m.includes('invalid') || m.includes('non-retryable')) return 'invalid_request';
  if (/meta capi 5\d\d/.test(m) || m.includes('server')) return 'server_error';
  return 'unknown';
}

/** One failure row as stored (per day, per reason) before window aggregation. */
export interface FailureRow {
  reason: string;
  events: number;
  lastMessage: string;
  lastAt: number; // epoch ms — to pick the most recent example per reason
}

/** Collapse per-day/per-reason failure rows into one breakdown row per reason. */
export function aggregateFailures(rows: FailureRow[]): FailureBreakdown[] {
  const byReason = new Map<string, { events: number; lastMessage: string; lastAt: number }>();
  for (const r of rows) {
    const cur = byReason.get(r.reason) ?? { events: 0, lastMessage: '', lastAt: -1 };
    cur.events += r.events;
    if (r.lastAt >= cur.lastAt) {
      cur.lastAt = r.lastAt;
      cur.lastMessage = r.lastMessage;
    }
    byReason.set(r.reason, cur);
  }
  return [...byReason.entries()]
    .map(([reason, v]) => ({ reason: reason as FailureReason, events: v.events, lastMessage: v.lastMessage }))
    .sort((a, b) => b.events - a.events);
}

/** Pure aggregation — derives totals + success rate + failure breakdown (unit-testable). */
export function summarize(daily: DailyStat[], failures: FailureRow[] = []): StatsSummary {
  const totals = daily.reduce(
    (a, d) => ({
      batches: a.batches + d.batches,
      dispatched: a.dispatched + d.dispatched,
      failed: a.failed + d.failed,
    }),
    { batches: 0, dispatched: 0, failed: 0 },
  );
  const attempts = totals.dispatched + totals.failed;
  const successRate = attempts === 0 ? null : Math.round((totals.dispatched / attempts) * 1e4) / 1e4;
  return { daily, totals, successRate, failures: aggregateFailures(failures) };
}

/**
 * Per-merchant, per-day CAPI delivery rollup.
 *
 * NOT a per-event store — events are never persisted. The worker calls
 * {@link record} once per flush; each call bumps a single counter row for the
 * current UTC day (INSERT … ON DUPLICATE KEY UPDATE col = col + n). So volume
 * drives counter values, never row count (~365 rows/merchant/year).
 */
@Injectable()
export class CapiStatsService {
  constructor(@Inject(META_DB_TOKEN) private readonly handle: KyselyClient<MetaDatabase>) {}

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Format a DATE column value as YYYY-MM-DD. mysql2 returns DATE as a JS Date
   * at LOCAL midnight, so we read the local Y/M/D parts (not toISOString, which
   * would shift the calendar day in non-UTC zones).
   */
  private static ymd(value: unknown): string {
    if (typeof value === 'string') return value.slice(0, 10);
    const d = value instanceof Date ? value : new Date(value as string);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** Increment today's counters for a merchant. Best-effort — stats must never break dispatch. */
  async record(merchantId: string, delta: { dispatched?: number; failed?: number; batches?: number }): Promise<void> {
    const dispatched = delta.dispatched ?? 0;
    const failed = delta.failed ?? 0;
    const batches = delta.batches ?? 0;
    if (!dispatched && !failed && !batches) return;
    await this.handle.db
      .insertInto('meta_capi_stats')
      .values({ merchantId, day: this.today(), batches, dispatched, failed })
      .onDuplicateKeyUpdate({
        batches: sql`batches + ${batches}`,
        dispatched: sql`dispatched + ${dispatched}`,
        failed: sql`failed + ${failed}`,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();
  }

  /**
   * Record a failed batch under its reason code (one row per merchant/day/reason).
   * `events` is the batch size attributed to this reason; `message` is one real
   * example kept for debugging. Best-effort — must never break the worker.
   */
  async recordFailure(merchantId: string, reason: FailureReason, message: string, events: number): Promise<void> {
    if (events <= 0) return;
    const msg = (message || '').slice(0, 512);
    await this.handle.db
      .insertInto('meta_capi_failures')
      .values({ merchantId, day: this.today(), reason, events, lastMessage: msg })
      .onDuplicateKeyUpdate({
        events: sql`events + ${events}`,
        lastMessage: msg,
        lastAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();
  }

  /** Last `days` UTC days of counters for a merchant + derived totals/success rate. */
  async getSummary(merchantId: string, days = 30): Promise<StatsSummary> {
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const [rows, fRows] = await Promise.all([
      this.handle.db
        .selectFrom('meta_capi_stats')
        .select(['day', 'batches', 'dispatched', 'failed'])
        .where('merchantId', '=', merchantId)
        .where('day', '>=', since)
        .orderBy('day', 'desc')
        .execute(),
      this.handle.db
        .selectFrom('meta_capi_failures')
        .select(['reason', 'events', 'lastMessage', 'lastAt'])
        .where('merchantId', '=', merchantId)
        .where('day', '>=', since)
        .execute(),
    ]);
    const daily: DailyStat[] = rows.map((r) => ({
      day: CapiStatsService.ymd(r.day),
      batches: Number(r.batches),
      dispatched: Number(r.dispatched),
      failed: Number(r.failed),
    }));
    const failures: FailureRow[] = fRows.map((r) => ({
      reason: r.reason,
      events: Number(r.events),
      lastMessage: r.lastMessage,
      lastAt: new Date(r.lastAt).getTime(),
    }));
    return summarize(daily, failures);
  }
}
