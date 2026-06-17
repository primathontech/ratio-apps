import { beforeEach, describe, expect, it, vi } from 'vitest';

// The handler uses `sql\`SELECT ... FOR UPDATE\`.execute(trx)` and
// `sql\`CURRENT_TIMESTAMP(3)\`` as a column value. Mock `sql` to a tagged-template
// stub that returns an `{ execute }` no-op, so we can drive the handler with a
// plain fake transaction (the raw query is a locking concern, not logic).
vi.mock('kysely', () => ({
  sql: (..._args: unknown[]) => ({ execute: vi.fn().mockResolvedValue(undefined) }),
}));

import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import { GoogleAppUninstalledHandler } from '../../../../src/modules/google/webhooks/app-uninstalled.handler';
import { GOOGLE_WEBHOOK_TOPICS } from '../../../../src/modules/google/webhooks/topics';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

/** Fake trx capturing the `.set()` payload per updated table. */
function fakeTrx(merchant: { isActive: boolean } | undefined) {
  const updates: Record<string, Record<string, unknown>> = {};
  const updateChain = (table: string) => ({
    set: (patch: Record<string, unknown>) => {
      updates[table] = patch;
      return { where: () => ({ execute: async () => undefined }) };
    },
  });
  const selectChain = {
    selectAll: () => selectChain,
    where: () => selectChain,
    limit: () => selectChain,
    executeTakeFirst: async () => merchant,
  };
  const trx = {
    selectFrom: () => selectChain,
    updateTable: (table: string) => updateChain(table),
  } as unknown as Trx;
  return { trx, updates };
}

describe('GoogleAppUninstalledHandler', () => {
  let handler: GoogleAppUninstalledHandler;
  beforeEach(() => {
    handler = new GoogleAppUninstalledHandler();
  });

  it('subscribes to the app-uninstalled topic', () => {
    expect(handler.topic).toBe(GOOGLE_WEBHOOK_TOPICS.appUninstalled);
  });

  it('disables both pixels and flips the merchant inactive (AC9)', async () => {
    const { trx, updates } = fakeTrx({ isActive: true });
    await handler.handle({}, 'm1', trx);

    expect(updates.google_configs).toMatchObject({
      ga4PixelStatus: 'disabled',
      adsPixelStatus: 'disabled',
    });
    expect(updates.merchants).toMatchObject({ isActive: false });
  });

  it('is a no-op for an already-inactive merchant (retry-safe)', async () => {
    const { trx, updates } = fakeTrx({ isActive: false });
    await handler.handle({}, 'm1', trx);
    expect(updates.google_configs).toBeUndefined();
    expect(updates.merchants).toBeUndefined();
  });

  it('is a no-op when merchantId is null', async () => {
    const { trx, updates } = fakeTrx(undefined);
    await handler.handle({}, null, trx);
    expect(updates).toEqual({});
  });
});
