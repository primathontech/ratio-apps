import type { Transaction } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { FbtBootstrap } from '../../../../src/modules/fbt/fbt.bootstrap';
import type { FbtDatabase } from '../../../../src/modules/fbt/db/types';

/**
 * Records the insert Kysely would have issued, without a database. Mirrors the
 * fake-handle style used by test/unit/apps/forms/config.service.test.ts.
 */
function fakeTrx() {
  const calls: Array<{ table: string; values: Record<string, unknown>; odku: unknown }> = [];
  const trx = {
    insertInto(table: string) {
      const record: { table: string; values: Record<string, unknown>; odku: unknown } = {
        table,
        values: {},
        odku: undefined,
      };
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
  it('seeds exactly one merchant_recommendation_config row', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe('merchant_recommendation_config');
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

    const values = calls[0]?.values ?? {};
    expect(values.merchantId).toBe('merch-1');
    expect(values.platform).toBe('openstore');
    expect(values.recommendationCount).toBe(3);
    expect(values.syncFrequency).toBe('daily');
    expect(values.syncHourUtc).toBe(4);
    expect(values.syncWeekday).toBeNull();
  });

  it('generates a distinct id per merchant', async () => {
    const a = fakeTrx();
    const b = fakeTrx();
    await new FbtBootstrap().run(a.trx, 'merch-1');
    await new FbtBootstrap().run(b.trx, 'merch-2');

    expect(a.calls[0]?.values.id).toBeTypeOf('string');
    expect(a.calls[0]?.values.id).not.toBe(b.calls[0]?.values.id);
  });

  it('uses ON DUPLICATE KEY UPDATE so a reinstall preserves existing settings', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    // A self-referencing no-op: the ODKU exists purely to suppress the
    // duplicate-key path. `.ignore()` would also swallow FK / NOT NULL errors.
    expect(calls[0]?.odku).toBeDefined();
  });

  it('encodes JSON list columns as strings — mysql2 does not auto-stringify', async () => {
    const { trx, calls } = fakeTrx();
    await new FbtBootstrap().run(trx, 'merch-1');

    expect(calls[0]?.values.productExcludedList).toBe('[]');
    expect(calls[0]?.values.productsWidgetDisabledList).toBe('[]');
  });
});
