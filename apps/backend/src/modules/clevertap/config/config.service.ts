import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLEVERTAP_REGIONS,
  type ClevertapRegion,
} from '@ratio-app/shared/constants/clevertap-events';
import type {
  ClevertapConfigInput,
  ClevertapConfigOutput,
} from '@ratio-app/shared/schemas/clevertap-config';
import { buildDefaultEventMap, type EventMap } from '@ratio-app/shared/schemas/event-map';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { ClevertapConfigRow, ClevertapDatabase } from '../db/types';
import { CLEVERTAP_DB_TOKEN } from '../kysely.module';
import { CLEVERTAP_CRYPTO } from '../tokens';

export function isClevertapRegion(value: string): value is ClevertapRegion {
  return Object.hasOwn(CLEVERTAP_REGIONS, value);
}

export interface ClevertapStatus {
  configComplete: boolean;
  serverEventsEnabled: boolean;
  lastEventAt: string | null;
  lastEventTopic: string | null;
  lastError: string | null;
  forwardedCount24h: number;
}

export interface ClevertapDeliveryTopicHealth {
  topic: string;
  sent: number;
  failed: number;
  skipped: number;
  lastAt: string | null;
}

export interface ClevertapDeliveryFailure {
  topic: string;
  clevertapEvent: string;
  error: string | null;
  sentAt: string;
}

export interface ClevertapDeliveryHealth {
  windowHours: number;
  sent: number;
  failed: number;
  skipped: number;
  queued: number;
  total: number;
  successRate: number | null;
  perTopic: ClevertapDeliveryTopicHealth[];
  recentFailures: ClevertapDeliveryFailure[];
}

@Injectable()
export class ClevertapConfigService {
  constructor(
    @Inject(CLEVERTAP_DB_TOKEN) private readonly handle: KyselyClient<ClevertapDatabase>,
    @Inject(CLEVERTAP_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  async getByMerchantId(merchantId: string): Promise<ClevertapConfigOutput> {
    const row = await this.findRow(merchantId);
    if (!row) {
      throw new NotFoundException({
        message: 'no clevertap config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return this.toOutput(row);
  }

  async upsert(merchantId: string, input: ClevertapConfigInput): Promise<ClevertapConfigOutput> {
    if (!isClevertapRegion(input.region)) {
      throw new BadRequestException({
        message: 'unknown clevertap region',
        error_code: 'CONFIG_INVALID_REGION',
      });
    }

    const existing = await this.findRow(merchantId);

    const touchPasscode = input.passcode !== undefined;
    const passcodeEnc = touchPasscode
      ? input.passcode
        ? this.crypto.encrypt(input.passcode)
        : null
      : undefined;
    const passcodeSet = touchPasscode
      ? Boolean(input.passcode)
      : Boolean(existing?.passcodeEnc ?? null);

    const serverEventsEnabled = input.serverEventsEnabled ?? Boolean(existing?.serverEventsEnabled);
    if (serverEventsEnabled && !passcodeSet) {
      throw new BadRequestException({
        message: 'cannot enable server-side events without a stored passcode',
        error_code: 'PASSCODE_REQUIRED',
      });
    }

    const events = input.events ?? existing?.events ?? buildDefaultEventMap('clevertap');
    const debug = input.debug ?? Boolean(existing?.debug);
    const catalogName = input.catalogName ?? existing?.catalogName ?? '';
    const catalogEmail = input.catalogEmail ?? existing?.catalogEmail ?? '';
    const catalogSyncEnabled = input.catalogSyncEnabled ?? Boolean(existing?.catalogSyncEnabled);
    const clevertapEnabled = input.clevertapEnabled ?? existing?.clevertapEnabled ?? true;
    const chargedSource = input.chargedSource ?? normalizeChargedSource(existing?.chargedSource);
    const disabledTopics = reconcileChargedTopic(
      input.disabledTopics ?? parseTopics(existing?.disabledTopics) ?? [],
      chargedSource,
    );
    const eventsJson = JSON.stringify(events) as unknown as EventMap;

    const cols = {
      accountId: input.accountId,
      region: input.region,
      serverEventsEnabled,
      debug,
      catalogName,
      catalogEmail,
      catalogSyncEnabled,
      clevertapEnabled,
      disabledTopics: JSON.stringify(disabledTopics) as unknown as string[],
      chargedSource,
      events: eventsJson,
    };
    const passcodeCol = touchPasscode ? { passcodeEnc: passcodeEnc ?? null } : {};

    await this.handle.db
      .insertInto('clevertap_configs')
      .values({ merchantId, ...cols, ...passcodeCol } as never)
      .onDuplicateKeyUpdate({
        ...cols,
        ...passcodeCol,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .execute();

    return {
      accountId: input.accountId,
      region: input.region,
      debug,
      serverEventsEnabled,
      catalogName,
      catalogEmail,
      catalogSyncEnabled,
      clevertapEnabled,
      disabledTopics,
      chargedSource,
      events,
      passcodeSet,
    };
  }

  async getStatus(merchantId: string): Promise<ClevertapStatus> {
    const row = await this.findRow(merchantId);

    const last = await this.handle.db
      .selectFrom('clevertap_forwarded_events')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('sentAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const counted = await this.handle.db
      .selectFrom('clevertap_forwarded_events')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'sent')
      .where('sentAt', '>=', since)
      .executeTakeFirst();

    return {
      configComplete: Boolean(row?.accountId) && isClevertapRegion(row?.region ?? ''),
      serverEventsEnabled: Boolean(row?.serverEventsEnabled),
      lastEventAt: last?.sentAt ? new Date(last.sentAt).toISOString() : null,
      lastEventTopic: last?.topic ?? null,
      lastError: last?.status === 'failed' ? (last.error ?? null) : null,
      forwardedCount24h: Number(counted?.count ?? 0),
    };
  }

  async getDeliveryHealth(merchantId: string): Promise<ClevertapDeliveryHealth> {
    const windowHours = 24;
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const rows = await this.handle.db
      .selectFrom('clevertap_forwarded_events')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('sentAt', '>=', since)
      .execute();

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let queued = 0;
    const topics = new Map<
      string,
      { topic: string; sent: number; failed: number; skipped: number; lastAt: Date | null }
    >();

    for (const r of rows) {
      if (r.status === 'sent') sent += 1;
      else if (r.status === 'failed') failed += 1;
      else if (r.status === 'skipped') skipped += 1;
      else if (r.status === 'queued' || r.status === 'enqueued') queued += 1;

      const t = topics.get(r.topic) ?? {
        topic: r.topic,
        sent: 0,
        failed: 0,
        skipped: 0,
        lastAt: null,
      };
      if (r.status === 'sent') t.sent += 1;
      else if (r.status === 'failed') t.failed += 1;
      else if (r.status === 'skipped') t.skipped += 1;
      const at = new Date(r.sentAt);
      if (!t.lastAt || at > t.lastAt) t.lastAt = at;
      topics.set(r.topic, t);
    }

    const perTopic: ClevertapDeliveryTopicHealth[] = [...topics.values()]
      .sort((a, b) => b.sent + b.failed + b.skipped - (a.sent + a.failed + a.skipped))
      .slice(0, 20)
      .map((t) => ({
        topic: t.topic,
        sent: t.sent,
        failed: t.failed,
        skipped: t.skipped,
        lastAt: t.lastAt ? t.lastAt.toISOString() : null,
      }));

    const failures = await this.handle.db
      .selectFrom('clevertap_forwarded_events')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'failed')
      .orderBy('sentAt', 'desc')
      .limit(10)
      .execute();

    const total = sent + failed + skipped;
    return {
      windowHours,
      sent,
      failed,
      skipped,
      queued,
      total,
      successRate: total === 0 ? null : Math.round((sent / total) * 100),
      perTopic,
      recentFailures: failures.map((f) => ({
        topic: f.topic,
        clevertapEvent: f.clevertapEvent,
        error: f.error ?? null,
        sentAt: new Date(f.sentAt).toISOString(),
      })),
    };
  }

  private async findRow(merchantId: string): Promise<ClevertapConfigRow | undefined> {
    return this.handle.db
      .selectFrom('clevertap_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
  }

  private toOutput(row: ClevertapConfigRow): ClevertapConfigOutput {
    return {
      accountId: row.accountId,
      region: row.region,
      debug: Boolean(row.debug),
      serverEventsEnabled: Boolean(row.serverEventsEnabled),
      catalogName: row.catalogName ?? '',
      catalogEmail: row.catalogEmail ?? '',
      catalogSyncEnabled: Boolean(row.catalogSyncEnabled),
      clevertapEnabled: Boolean(row.clevertapEnabled),
      disabledTopics: parseTopics(row.disabledTopics) ?? [],
      chargedSource: normalizeChargedSource(row.chargedSource),
      lastCatalogSyncAt: row.lastCatalogSyncAt
        ? new Date(row.lastCatalogSyncAt).toISOString()
        : null,
      lastCatalogSyncStatus: normalizeSyncStatus(row.lastCatalogSyncStatus),
      lastCatalogSyncCount: row.lastCatalogSyncCount ?? null,
      lastCatalogSyncError: row.lastCatalogSyncError ?? null,
      events: row.events,
      passcodeSet: Boolean(row.passcodeEnc),
    };
  }
}

function normalizeSyncStatus(value: unknown): 'sent' | 'skipped' | 'failed' | null {
  return value === 'sent' || value === 'skipped' || value === 'failed' ? value : null;
}

function normalizeChargedSource(value: unknown): 'server' | 'client' {
  return value === 'client' ? 'client' : 'server';
}

const CLEVERTAP_CHARGED_TOPIC = 'orders/paid';
function reconcileChargedTopic(topics: string[], chargedSource: 'server' | 'client'): string[] {
  const rest = topics.filter((t) => t !== CLEVERTAP_CHARGED_TOPIC);
  return chargedSource === 'client' ? [...rest, CLEVERTAP_CHARGED_TOPIC] : rest;
}

function parseTopics(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  const arr = typeof value === 'string' ? safeJsonArray(value) : value;
  return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : undefined;
}

function safeJsonArray(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
