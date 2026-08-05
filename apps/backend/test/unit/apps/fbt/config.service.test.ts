import { describe, expect, it } from 'vitest';
import { FbtConfigService } from '../../../../src/modules/fbt/config/config.service';

/**
 * Records the update Kysely would have issued. Fake-handle style, same as
 * bootstrap.test.ts — no database.
 */
function fakeHandle(existingRow: Record<string, unknown> | undefined) {
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    selectFrom() {
      return {
        selectAll() {
          return this;
        },
        where() {
          return this;
        },
        limit() {
          return this;
        },
        async executeTakeFirst() {
          return existingRow;
        },
      };
    },
    updateTable() {
      return {
        set(values: Record<string, unknown>) {
          updates.push(values);
          return this;
        },
        where() {
          return this;
        },
        async execute() {
          return [{ numUpdatedRows: 1n }];
        },
      };
    },
    insertInto() {
      return {
        values(values: Record<string, unknown>) {
          inserts.push(values);
          return this;
        },
        onDuplicateKeyUpdate() {
          return this;
        },
        async execute() {
          return [];
        },
      };
    },
  };
  return { handle: { db } as never, updates, inserts };
}

const BASE_ROW = {
  merchantId: 'm-1',
  allowAutomaticRecommendation: false,
  recommendationCount: 3,
  productExcludedList: [],
  productsWidgetDisabledList: [],
  uiConfig: null,
  syncFrequency: 'daily' as const,
  syncHourUtc: 4,
  syncWeekday: null,
  nextRunAt: null,
  lastRunAt: null,
  previewBaseUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const INPUT = {
  allowAutomaticRecommendation: false,
  recommendationCount: 3,
  syncFrequency: 'daily' as const,
  syncHourUtc: 4,
  syncWeekday: null,
  productExcludedList: [],
  productsWidgetDisabledList: [],
  uiConfig: null,
  previewBaseUrl: null,
};

describe('FbtConfigService.upsert — the toggle-on contract', () => {
  it('sets nextRunAt when automatic recommendation is switched ON', async () => {
    const { handle, updates } = fakeHandle(BASE_ROW);
    await new FbtConfigService(handle).upsert('m-1', {
      ...INPUT,
      allowAutomaticRecommendation: true,
    });

    // Must be written in the SAME update as the boolean. A merchant who opts in
    // and gets nextRunAt = NULL is excluded by the sweep's due-selection query
    // forever, with no error raised anywhere.
    expect(updates).toHaveLength(1);
    expect(updates[0]?.allowAutomaticRecommendation).toBe(true);
    expect(updates[0]?.nextRunAt).toBeInstanceOf(Date);
  });

  it('clears nextRunAt when automatic recommendation is switched OFF', async () => {
    const { handle, updates } = fakeHandle({
      ...BASE_ROW,
      allowAutomaticRecommendation: true,
      nextRunAt: new Date('2026-01-01T04:00:00Z'),
    });
    await new FbtConfigService(handle).upsert('m-1', {
      ...INPUT,
      allowAutomaticRecommendation: false,
    });

    expect(updates[0]?.nextRunAt).toBeNull();
  });

  it('leaves nextRunAt untouched when the toggle does not change', async () => {
    const already = new Date('2026-06-01T04:00:00Z');
    const { handle, updates } = fakeHandle({
      ...BASE_ROW,
      allowAutomaticRecommendation: true,
      nextRunAt: already,
    });
    await new FbtConfigService(handle).upsert('m-1', {
      ...INPUT,
      allowAutomaticRecommendation: true,
      recommendationCount: 5,
    });

    // Re-saving an unrelated field must not reschedule the merchant — that would
    // let a merchant who edits their config repeatedly jump the sweep queue.
    expect(updates[0]).not.toHaveProperty('nextRunAt');
    expect(updates[0]?.recommendationCount).toBe(5);
  });

  it('stringifies JSON list and object columns — mysql2 does not auto-stringify', async () => {
    const { handle, updates } = fakeHandle(BASE_ROW);
    await new FbtConfigService(handle).upsert('m-1', {
      ...INPUT,
      productExcludedList: ['p-1', 'p-2'],
      productsWidgetDisabledList: [],
      uiConfig: { accentColor: '#000' },
    });

    expect(updates[0]?.productExcludedList).toBe('["p-1","p-2"]');
    expect(updates[0]?.productsWidgetDisabledList).toBe('[]');
    expect(updates[0]?.uiConfig).toBe('{"accentColor":"#000"}');
  });

  it('writes uiConfig as NULL, not the string "null", when cleared', async () => {
    const { handle, updates } = fakeHandle(BASE_ROW);
    await new FbtConfigService(handle).upsert('m-1', { ...INPUT, uiConfig: null });

    expect(updates[0]?.uiConfig).toBeNull();
  });

  it('never lets a client write server-owned scheduling state', async () => {
    const { handle, updates } = fakeHandle(BASE_ROW);
    await new FbtConfigService(handle).upsert('m-1', {
      ...INPUT,
      // Deliberately smuggled in — the input schema strips these, and the
      // service must not forward them even if they arrive.
      lastRunAt: new Date('2020-01-01'),
    } as never);

    expect(updates[0]).not.toHaveProperty('lastRunAt');
  });
});

describe('FbtConfigService.getByMerchantId', () => {
  it('throws CONFIG_NOT_FOUND when the merchant has no row', async () => {
    const { handle } = fakeHandle(undefined);
    await expect(new FbtConfigService(handle).getByMerchantId('nope')).rejects.toThrow();
  });

  it('serialises Date columns to ISO strings', async () => {
    const { handle } = fakeHandle(BASE_ROW);
    const out = await new FbtConfigService(handle).getByMerchantId('m-1');

    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.nextRunAt).toBeNull();
  });
});
