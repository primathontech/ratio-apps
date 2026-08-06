import { describe, expect, it } from 'vitest';
import { UcConfigService } from '../../../../src/modules/unicommerce/services/config.service';

type Row = Record<string, unknown>;

/**
 * Hand-rolled fake Kysely handle covering the three shapes UcConfigService
 * uses against `ucConfigs`: select (where + executeTakeFirst), plain insert,
 * and the upsert form (insertInto → values → onDuplicateKeyUpdate → execute).
 * `onDuplicateKeyUpdate` merges the update patch into an existing row by
 * primary key (mirroring MySQL semantics) so a partial upsert only touches
 * the fields it was given.
 */
function fakeHandle(seed: { ucConfigs?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    ucConfigs: seed.ucConfigs ?? [],
  };

  const db = {
    selectFrom: (table: string) => {
      const filters: Array<(row: Row) => boolean> = [];
      const builder = {
        select: () => builder,
        selectAll: () => builder,
        where: (col: string, _op: string, val: unknown) => {
          filters.push((row) => row[col] === val);
          return builder;
        },
        execute: async () => tables[table].filter((r) => filters.every((f) => f(r))),
        executeTakeFirst: async () => tables[table].find((r) => filters.every((f) => f(r))),
      };
      return builder;
    },
    insertInto: (table: string) => ({
      values: (v: Row) => ({
        onDuplicateKeyUpdate: (update: Row) => ({
          execute: async () => {
            const existing = tables[table].find((r) => r.merchantId === v.merchantId);
            if (existing) {
              Object.assign(existing, update);
            } else {
              tables[table].push({ ...v });
            }
          },
        }),
        execute: async () => {
          tables[table].push({ ...v });
        },
      }),
    }),
  };

  return { handle: { db }, tables };
}

const allFalse = {
  productSyncEnabled: false,
  inventorySyncEnabled: false,
  orderPushEnabled: false,
  dispatchStatusSyncEnabled: false,
  cancelSyncEnabled: false,
  notificationsEnabled: false,
};

describe('UcConfigService.getByMerchantId', () => {
  it('returns an all-false config (not a throw) when no row exists for the merchant', async () => {
    const { handle } = fakeHandle();
    const svc = new UcConfigService(handle as never);

    const config = await svc.getByMerchantId('m1');

    expect(config).toEqual(allFalse);
  });

  it('returns the stored row values, coercing each column to a boolean', async () => {
    const { handle } = fakeHandle({
      ucConfigs: [
        {
          merchantId: 'm1',
          productSyncEnabled: 1,
          inventorySyncEnabled: 0,
          orderPushEnabled: 1,
          dispatchStatusSyncEnabled: 0,
          cancelSyncEnabled: 1,
          notificationsEnabled: 0,
        },
      ],
    });
    const svc = new UcConfigService(handle as never);

    const config = await svc.getByMerchantId('m1');

    expect(config).toEqual({
      productSyncEnabled: true,
      inventorySyncEnabled: false,
      orderPushEnabled: true,
      dispatchStatusSyncEnabled: false,
      cancelSyncEnabled: true,
      notificationsEnabled: false,
    });
  });
});

describe('UcConfigService.upsert', () => {
  it('creates a new config row for a merchant with no existing row', async () => {
    const { handle, tables } = fakeHandle();
    const svc = new UcConfigService(handle as never);

    const result = await svc.upsert('m1', { productSyncEnabled: true });

    expect(tables.ucConfigs).toHaveLength(1);
    expect(tables.ucConfigs[0]).toMatchObject({ merchantId: 'm1', productSyncEnabled: true });
    expect(result.productSyncEnabled).toBe(true);
    expect(result.inventorySyncEnabled).toBe(false);
    expect(result.orderPushEnabled).toBe(false);
  });

  it('updates only the given fields of an existing row, keeping the prior values of untouched flags', async () => {
    const existing = {
      merchantId: 'm1',
      productSyncEnabled: true,
      inventorySyncEnabled: true,
      orderPushEnabled: true,
      dispatchStatusSyncEnabled: true,
      cancelSyncEnabled: true,
      notificationsEnabled: true,
    };
    const { handle, tables } = fakeHandle({ ucConfigs: [existing] });
    const svc = new UcConfigService(handle as never);

    const result = await svc.upsert('m1', { orderPushEnabled: false });

    expect(tables.ucConfigs).toHaveLength(1);
    expect(tables.ucConfigs[0]).toMatchObject({
      orderPushEnabled: false,
      productSyncEnabled: true,
      inventorySyncEnabled: true,
      dispatchStatusSyncEnabled: true,
      cancelSyncEnabled: true,
      notificationsEnabled: true,
    });
    expect(result.orderPushEnabled).toBe(false);
    expect(result.productSyncEnabled).toBe(true);
    expect(result.notificationsEnabled).toBe(true);
  });
});
