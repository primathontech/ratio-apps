import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleFeedController } from '../../../../src/modules/google/gmc/feed.controller';
import { FeedSyncService } from '../../../../src/modules/google/gmc/feed-sync.service';

/**
 * Bug: repeated GMC "Force Sync" requests spawned overlapping full syncs for the
 * same merchant (no in-flight guard). The pile-up exhausted the DB pool /
 * upstream and surfaced as intermittent 500s on later requests. A full sync is
 * now deduped per merchant: the second concurrent request is rejected (429
 * SYNC_IN_PROGRESS) instead of launching another sync.
 */

// gmc-enabled config row so `context()` resolves non-null.
const CONFIG_ROW = {
  merchantId: 'm1',
  gmcEnabled: 1,
  gmcMerchantId: '123456',
  gmcTargetCountry: 'IN',
  gmcContentLanguage: 'en',
  gmcCurrency: 'INR',
  gmcDefaultCondition: 'new',
  gmcBrandOverride: null,
  gmcGoogleProductCategory: null,
};

// Minimal chainable Kysely stub so the REAL fullSync runs to completion
// (resolve config → no products → write sync log) without a database.
function makeHandle() {
  const qb: Record<string, unknown> = {};
  for (const m of [
    'insertInto',
    'values',
    'selectFrom',
    'select',
    'selectAll',
    'where',
    'orderBy',
    'limit',
    'onDuplicateKeyUpdate',
    'updateTable',
    'set',
  ]) {
    qb[m] = () => qb;
  }
  qb.execute = async () => [];
  qb.executeTakeFirst = async () => CONFIG_ROW;
  return { db: qb, close: async () => {} };
}

function makeService(): FeedSyncService {
  const handle = makeHandle();
  const auth = { getGmcAccessToken: vi.fn().mockResolvedValue('tok') } as never;
  const products = { listAll: vi.fn().mockResolvedValue([]), getById: vi.fn() } as never;
  return new FeedSyncService(handle as never, auth, products);
}

describe('FeedSyncService force-sync dedup', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('rejects a second concurrent start for the same merchant', () => {
    const svc = makeService();

    expect(svc.isSyncRunning('m1')).toBe(false);

    const first = svc.startForceSyncInBackground('m1');
    expect(first).toBe(true);
    expect(svc.isSyncRunning('m1')).toBe(true);

    const second = svc.startForceSyncInBackground('m1');
    expect(second).toBe(false);
  });

  it('does not block a different merchant', () => {
    const svc = makeService();

    expect(svc.startForceSyncInBackground('m1')).toBe(true);
    expect(svc.startForceSyncInBackground('m2')).toBe(true);
  });

  it('allows a new sync once the previous run finishes', async () => {
    const svc = makeService();

    expect(svc.startForceSyncInBackground('m1')).toBe(true);
    await vi.waitFor(() => expect(svc.isSyncRunning('m1')).toBe(false));
    expect(svc.startForceSyncInBackground('m1')).toBe(true);
  });
});

describe('GoogleFeedController POST /sync dedup', () => {
  const merchant = { id: 'm1', isActive: true } as Merchant;

  it('returns started:true when the sync actually starts', () => {
    const sync = { startForceSyncInBackground: vi.fn().mockReturnValue(true) };
    const ctrl = new GoogleFeedController({} as never, sync as never);

    expect(ctrl.forceSync(merchant)).toEqual({ started: true });
  });

  it('throws 429 SYNC_IN_PROGRESS when a sync is already running', () => {
    const sync = { startForceSyncInBackground: vi.fn().mockReturnValue(false) };
    const ctrl = new GoogleFeedController({} as never, sync as never);

    try {
      ctrl.forceSync(merchant);
      expect.unreachable('expected forceSync() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = ex.getResponse() as { error_code?: string };
      expect(body.error_code).toBe('SYNC_IN_PROGRESS');
    }
  });
});
