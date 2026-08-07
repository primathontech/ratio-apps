import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ops: [] as string[], sqlTexts: [] as string[] }));

vi.mock('kysely', () => ({
  sql: (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    h.sqlTexts.push(text);
    return {
      execute: async () => {
        h.ops.push(`raw-sql:${text.trim()}`);
        return undefined;
      },
    };
  },
}));

import type { Transaction } from 'kysely';
import type { DatabaseWithMerchants } from '../../../../src/core/merchants/merchant.types';
import type { DatabaseWithWebhookLog } from '../../../../src/core/webhooks/webhook-log.types';
import { ClevertapAppUninstalledHandler } from '../../../../src/modules/clevertap/webhooks/app-uninstalled.handler';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';

type Trx = Transaction<DatabaseWithMerchants & DatabaseWithWebhookLog>;

interface MerchantsSpy {
  calls: string[];
}

function fakeTrx(merchant: { isActive: boolean } | undefined) {
  const updates: Record<string, Record<string, unknown>> = {};
  const trx = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        where: () => chain,
        limit: () => chain,
        executeTakeFirst: async () => {
          h.ops.push(`select:${table}`);
          return table === 'merchants' ? merchant : undefined;
        },
      };
      return chain;
    },
    updateTable(table: string) {
      const chain = {
        set: (patch: Record<string, unknown>) => {
          updates[table] = patch;
          return chain;
        },
        where: () => chain,
        execute: async () => {
          h.ops.push(`update:${table}`);
          return [];
        },
      };
      return chain;
    },
    deleteFrom(table: string) {
      const chain = {
        where: () => chain,
        execute: async () => {
          h.ops.push(`delete:${table}`);
          return [];
        },
      };
      return chain;
    },
  } as unknown as Trx;
  return { trx, updates };
}

function merchantsSpy(): { service: never; spy: MerchantsSpy } {
  const spy: MerchantsSpy = { calls: [] };
  const service = new Proxy(
    {},
    {
      get(_t, prop) {
        return (...__args: unknown[]) => {
          spy.calls.push(String(prop));
          throw new Error(`MerchantsService.${String(prop)} must not be called from the handler`);
        };
      },
    },
  ) as never;
  return { service, spy };
}

describe('ClevertapAppUninstalledHandler', () => {
  beforeEach(() => {
    h.ops.length = 0;
    h.sqlTexts.length = 0;
  });

  it('subscribes to the slash-form app/uninstalled topic (not the template dot form)', () => {
    const { service } = merchantsSpy();
    const handler = new ClevertapAppUninstalledHandler(service);
    expect(handler.topic).toBe(CLEVERTAP_WEBHOOK_TOPICS.appUninstalled);
    expect(handler.topic).toBe('app/uninstalled');
    expect(handler.topic).not.toBe('app.uninstalled');
  });

  it('flips is_active=false and sets uninstalled_at', async () => {
    const { service } = merchantsSpy();
    const { trx, updates } = fakeTrx({ isActive: true });
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);

    expect(updates.merchants).toMatchObject({ isActive: false });
    expect(updates.merchants?.uninstalledAt).toBeDefined();
    expect(updates.merchants?.updatedAt).toBeDefined();
  });

  it('preserves clevertap_configs — no update, no delete', async () => {
    const { service } = merchantsSpy();
    const { trx, updates } = fakeTrx({ isActive: true });
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);

    expect(updates.clevertap_configs).toBeUndefined();
    expect(h.ops).not.toContain('update:clevertap_configs');
    expect(h.ops).not.toContain('delete:clevertap_configs');
    expect(h.ops.filter((op) => op.includes('clevertap_configs'))).toEqual([]);
  });

  it('takes SELECT … FOR UPDATE on the merchant row BEFORE the update', async () => {
    const { service } = merchantsSpy();
    const { trx } = fakeTrx({ isActive: true });
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);

    const lockIdx = h.ops.findIndex((op) => op.startsWith('raw-sql:SELECT id FROM merchants'));
    const updateIdx = h.ops.indexOf('update:merchants');
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(lockIdx);
    expect(h.sqlTexts.some((t) => t.includes('FOR UPDATE'))).toBe(true);
  });

  it('locks before even READING the merchant, so a concurrent OAuth reinstall serialises', async () => {
    const { service } = merchantsSpy();
    const { trx } = fakeTrx({ isActive: true });
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);
    expect(h.ops[0]).toContain('raw-sql:SELECT id FROM merchants');
    expect(h.ops[1]).toBe('select:merchants');
  });

  it('no-ops for an already-inactive merchant (retry-safe)', async () => {
    const { service } = merchantsSpy();
    const { trx, updates } = fakeTrx({ isActive: false });
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);
    expect(updates.merchants).toBeUndefined();
    expect(h.ops).not.toContain('update:merchants');
  });

  it('no-ops for an unknown merchant row', async () => {
    const { service } = merchantsSpy();
    const { trx, updates } = fakeTrx(undefined);
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);
    expect(updates).toEqual({});
  });

  it('no-ops for a null merchantId without taking the lock', async () => {
    const { service } = merchantsSpy();
    const { trx, updates } = fakeTrx(undefined);
    await new ClevertapAppUninstalledHandler(service).handle({}, null, trx);
    expect(updates).toEqual({});
    expect(h.ops).toEqual([]);
  });

  it('writes through trx, NOT the injected MerchantsService', async () => {
    const { service, spy } = merchantsSpy();
    const { trx, updates } = fakeTrx({ isActive: true });
    await new ClevertapAppUninstalledHandler(service).handle({}, 'm1', trx);

    expect(spy.calls).toEqual([]);
    expect(updates.merchants).toBeDefined();
  });
});
