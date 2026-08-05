import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { FbtDatabase } from '../../../../src/modules/fbt/db/types';
import { FbtBootstrap } from '../../../../src/modules/fbt/fbt.bootstrap';

/**
 * Records the insert Kysely would have issued, without a database. Mirrors the
 * fake-handle style of test/unit/apps/forms/config.service.test.ts.
 */
function fakeTrx() {
  const calls: Array<{ table: string; values: Record<string, unknown>; odku: unknown }> = [];
  const trx = {
    insertInto(table: string) {
      const record = { table, values: {} as Record<string, unknown>, odku: undefined as unknown };
      return {
        values(values: Record<string, unknown>) {
          record.values = values;
          return this;
        },
        onDuplicateKeyUpdate(odku: unknown) {
          record.odku = odku;
          return this;
        },
        async execute() {
          calls.push(record);
        },
      };
    },
  } as unknown as Transaction<FbtDatabase>;
  return { trx, calls };
}

describe('FbtBootstrap', () => {
  it('seeds exactly one fbt_merchant_config row', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('fbt_merchant_config');
  });

  it('defaults automatic recommendation OFF so install spends no OpenAI budget', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    expect(calls[0]?.values.allowAutomaticRecommendation).toBe(false);
  });

  it('leaves nextRunAt null so an opted-out merchant never matches the sweep', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    expect(calls[0]?.values.nextRunAt).toBeNull();
  });

  it('seeds the documented schedule and count defaults', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    const v = calls[0]?.values ?? {};
    expect(v.merchantId).toBe('merch-1');
    expect(v.recommendationCount).toBe(3);
    expect(v.syncFrequency).toBe('daily');
    expect(v.syncHourUtc).toBe(4);
    expect(v.syncWeekday).toBeNull();
    expect(v.lastRunAt).toBeNull();
  });

  it('writes no surrogate id and no platform column', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    // Greenfield: merchantId IS the primary key, and platform does not exist.
    expect(calls[0]?.values).not.toHaveProperty('id');
    expect(calls[0]?.values).not.toHaveProperty('platform');
  });

  it('uses ON DUPLICATE KEY UPDATE so a reinstall preserves existing settings', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    // Assert the SHAPE, not just presence: `toBeDefined()` passes for any truthy
    // object, including a regression that replaced the self-referencing no-op with a
    // real field write and reset the merchant's settings on every reinstall.
    expect(Object.keys(calls[0]?.odku ?? {})).toEqual(['merchantId']);
  });

  it('encodes JSON list columns as strings — mysql2 does not auto-stringify', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    expect(calls[0]?.values.productExcludedList).toBe('[]');
    expect(calls[0]?.values.productsWidgetDisabledList).toBe('[]');
  });
});
