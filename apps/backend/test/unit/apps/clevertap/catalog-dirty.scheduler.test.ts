import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClevertapCatalogDirtyScheduler } from '../../../../src/modules/clevertap/sync/catalog-dirty.scheduler';
import type { ClevertapCatalogSyncService } from '../../../../src/modules/clevertap/sync/catalog-sync.service';

const MERCHANT = 'merchant-1';
const DEBOUNCE_MS = 1_000;

function build() {
  const syncMerchant = vi.fn().mockResolvedValue({ status: 'sent' });
  const sync = { syncMerchant } as unknown as ClevertapCatalogSyncService;
  const scheduler = new ClevertapCatalogDirtyScheduler(sync, DEBOUNCE_MS);
  return { syncMerchant, scheduler };
}

describe('ClevertapCatalogDirtyScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces two markDirty calls within the window into ONE sync', () => {
    const { syncMerchant, scheduler } = build();

    scheduler.markDirty(MERCHANT);
    scheduler.markDirty(MERCHANT);
    expect(syncMerchant).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncMerchant).toHaveBeenCalledTimes(1);
    expect(syncMerchant).toHaveBeenCalledWith(MERCHANT);
  });

  it('re-syncs again for a new burst after the timer fires', () => {
    const { syncMerchant, scheduler } = build();

    scheduler.markDirty(MERCHANT);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    scheduler.markDirty(MERCHANT);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(syncMerchant).toHaveBeenCalledTimes(2);
  });

  it('debounces each merchant independently', () => {
    const { syncMerchant, scheduler } = build();

    scheduler.markDirty(MERCHANT);
    scheduler.markDirty('merchant-2');
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(syncMerchant).toHaveBeenCalledTimes(2);
    expect(syncMerchant).toHaveBeenCalledWith(MERCHANT);
    expect(syncMerchant).toHaveBeenCalledWith('merchant-2');
  });

  it('onModuleDestroy clears pending timers so no sync runs', () => {
    const { syncMerchant, scheduler } = build();

    scheduler.markDirty(MERCHANT);
    scheduler.onModuleDestroy();
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(syncMerchant).not.toHaveBeenCalled();
  });
});
