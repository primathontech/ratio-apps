import { describe, expect, it, vi } from 'vitest';

// The handler uses `sql\`SELECT ... FOR UPDATE\`.execute(trx)` and
// `sql\`CURRENT_TIMESTAMP(3)\`` as a column value — stub the tag so a plain
// fake transaction drives the handler.
vi.mock('kysely', () => ({
  sql: (..._args: unknown[]) => ({ execute: vi.fn().mockResolvedValue(undefined) }),
}));

import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { MerchantsService } from '../../../../src/core/merchants/merchants.service';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import type { DelhiveryDatabase } from '../../../../src/modules/delhivery/db/types';
import { DelhiveryAppUninstalledHandler } from '../../../../src/modules/delhivery/webhooks/app-uninstalled.handler';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

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

const merchants = {} as MerchantsService<DelhiveryDatabase>;

describe('DelhiveryAppUninstalledHandler', () => {
  it('subscribes to the slash-form app/uninstalled topic (learnings.md)', () => {
    expect(new DelhiveryAppUninstalledHandler(merchants).topic).toBe('app/uninstalled');
  });

  it('webhook.uninstalledFlipsInactive — flips the merchant inactive', async () => {
    const { trx, updates } = fakeTrx({ isActive: true });
    await new DelhiveryAppUninstalledHandler(merchants).handle({}, 'm1', trx);
    expect(updates.merchants).toMatchObject({ isActive: false });
  });

  it('is a no-op for an already-inactive merchant (retry-safe)', async () => {
    const { trx, updates } = fakeTrx({ isActive: false });
    await new DelhiveryAppUninstalledHandler(merchants).handle({}, 'm1', trx);
    expect(updates.merchants).toBeUndefined();
  });

  it('is a no-op when merchantId is null', async () => {
    const { trx, updates } = fakeTrx(undefined);
    await new DelhiveryAppUninstalledHandler(merchants).handle({}, null, trx);
    expect(updates).toEqual({});
  });
});
