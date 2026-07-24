import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { LoyaltyDatabase } from '../../../../src/modules/loyalty/db/types';
import type { RuleCacheService } from '../../../../src/modules/loyalty/rules/rule-cache.service';
import { RulesService } from '../../../../src/modules/loyalty/rules/rules.service';
import { MERCHANT_ID } from './helpers/fakes';

const VALID_INPUT = {
  name: 'Triple points',
  ruleType: 'MULTIPLIER',
  value: 3,
  targetType: 'SEGMENT',
  conditions: { field: 'order_total', operator: 'gt', value: 500 },
  startsAt: '2026-01-01T00:00:00.000Z',
  priority: 5,
};

function mkRuleRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'rule-1',
    merchantId: MERCHANT_ID,
    name: 'Triple points',
    ruleType: 'MULTIPLIER',
    value: '3.00',
    targetType: 'SEGMENT',
    conditions: '{"field":"order_total","operator":"gt","value":500}',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: null,
    active: 1,
    priority: 5,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

interface Captured {
  inserts: { table: string; values: unknown }[];
  updates: { table: string; set: Record<string, unknown> }[];
  deletes: { table: string; wheres: unknown[][] }[];
}

function makeDb(
  opts: {
    ruleRow?: Record<string, unknown>;
    perfRow?: Record<string, unknown>;
    customers?: { phone: string }[];
  } = {},
) {
  const captured: Captured = { inserts: [], updates: [], deletes: [] };
  const db = {
    selectFrom(table: string) {
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        execute: () =>
          Promise.resolve(
            table === 'loyalty_rule_customers'
              ? (opts.customers ?? [])
              : opts.ruleRow
                ? [opts.ruleRow]
                : [],
          ),
        executeTakeFirst: () =>
          Promise.resolve(
            table === 'loyalty_rules'
              ? opts.ruleRow
              : table === 'loyalty_rule_applications'
                ? opts.perfRow
                : table === 'loyalty_rule_customers'
                  ? { total: (opts.customers ?? []).length }
                  : undefined,
          ),
      };
      return chain;
    },
    insertInto(table: string) {
      let values: unknown;
      const chain = {
        ignore: () => chain,
        values: (v: unknown) => {
          values = v;
          captured.inserts.push({ table, values: v });
          return chain;
        },
        execute: () => Promise.resolve([]),
        executeTakeFirst: () =>
          Promise.resolve({
            numInsertedOrUpdatedRows: BigInt(Array.isArray(values) ? values.length : 1),
          }),
      };
      return chain;
    },
    updateTable(table: string) {
      const chain = {
        set: (v: Record<string, unknown>) => {
          captured.updates.push({ table, set: v });
          return chain;
        },
        where: () => chain,
        execute: () => Promise.resolve([]),
        executeTakeFirst: () => Promise.resolve({ numUpdatedRows: 1n }),
      };
      return chain;
    },
    deleteFrom(table: string) {
      const wheres: unknown[][] = [];
      const chain = {
        where: (...args: unknown[]) => {
          wheres.push(args);
          return chain;
        },
        execute: () => {
          captured.deletes.push({ table, wheres });
          return Promise.resolve([]);
        },
        executeTakeFirst: () => {
          captured.deletes.push({ table, wheres });
          return Promise.resolve({ numDeletedRows: 1n });
        },
      };
      return chain;
    },
  };
  return { handle: { db } as unknown as KyselyClient<LoyaltyDatabase>, captured };
}

function setup(opts: Parameters<typeof makeDb>[0] = {}) {
  const { handle, captured } = makeDb(opts);
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const cache = { invalidate } as unknown as RuleCacheService;
  const service = new RulesService(handle, cache);
  return { service, captured, invalidate };
}

describe('RulesService', () => {
  it('create validates the shared schema, writes stringified conditions, ULID id, and invalidates', async () => {
    const { service, captured, invalidate } = setup();
    const out = await service.create(MERCHANT_ID, VALID_INPUT);

    const insert = captured.inserts.find((i) => i.table === 'loyalty_rules');
    expect(insert).toBeDefined();
    const v = insert?.values as Record<string, unknown>;
    expect(typeof v.id).toBe('string');
    expect((v.id as string).length).toBe(26); // ULID
    expect(v.merchantId).toBe(MERCHANT_ID);
    expect(typeof v.conditions).toBe('string');
    expect(JSON.parse(v.conditions as string)).toEqual(VALID_INPUT.conditions);
    expect(invalidate).toHaveBeenCalledWith(MERCHANT_ID);
    expect(out.id).toBe(v.id);
    expect(out.value).toBe(3);
  });

  it('create rejects schema-invalid input without writing or invalidating', async () => {
    const { service, captured, invalidate } = setup();
    // MULTIPLIER with value 1 grants nothing — schema rejects it
    await expect(service.create(MERCHANT_ID, { ...VALID_INPUT, value: 1 })).rejects.toThrow();
    expect(captured.inserts).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('get parses conditions and 404s on unknown/foreign rule', async () => {
    const { service } = setup({ ruleRow: mkRuleRow() });
    const rule = await service.get(MERCHANT_ID, 'rule-1');
    expect(rule.conditions).toEqual({ field: 'order_total', operator: 'gt', value: 500 });
    expect(rule.active).toBe(true);
    expect(rule.value).toBe(3);

    const { service: empty } = setup();
    await expect(empty.get(MERCHANT_ID, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('appendCustomers normalizes phones, skips+reports invalid, dedupes, and invalidates', async () => {
    const { service, captured, invalidate } = setup({ ruleRow: mkRuleRow() });
    const res = await service.appendCustomers(MERCHANT_ID, 'rule-1', [
      '9876543210',
      'not-a-phone',
      '+91 98765-11111',
      '9876543210', // duplicate of the first
    ]);

    const insert = captured.inserts.find((i) => i.table === 'loyalty_rule_customers');
    const rows = insert?.values as { ruleId: string; phone: string }[];
    expect(rows.map((r) => r.phone)).toEqual(['+919876543210', '+919876511111']);
    expect(rows.every((r) => r.ruleId === 'rule-1')).toBe(true);
    expect(res.invalid).toBe(1);
    expect(res.added).toBe(2);
    expect(invalidate).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('performance aggregates matches/extraCoins/uniqueCustomers', async () => {
    const { service } = setup({
      ruleRow: mkRuleRow(),
      perfRow: { matches: 5, extraCoins: '1200', uniqueCustomers: 3 },
    });
    await expect(service.performance(MERCHANT_ID, 'rule-1')).resolves.toEqual({
      matches: 5,
      extraCoins: 1200,
      uniqueCustomers: 3,
    });
  });

  it('every mutation invalidates the rule cache', async () => {
    const { service, invalidate } = setup({ ruleRow: mkRuleRow() });

    await service.create(MERCHANT_ID, VALID_INPUT);
    await service.update(MERCHANT_ID, 'rule-1', VALID_INPUT);
    await service.setActive(MERCHANT_ID, 'rule-1', false);
    await service.appendCustomers(MERCHANT_ID, 'rule-1', ['9876543210']);
    await service.removeCustomers(MERCHANT_ID, 'rule-1', ['9876543210']);
    await service.delete(MERCHANT_ID, 'rule-1');

    expect(invalidate).toHaveBeenCalledTimes(6);
    expect(invalidate).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('listCustomers pages the rule membership', async () => {
    const { service } = setup({
      ruleRow: mkRuleRow(),
      customers: [{ phone: '+919876543210' }, { phone: '+919876511111' }],
    });
    const page = await service.listCustomers(MERCHANT_ID, 'rule-1', 1, 20);
    expect(page.items).toEqual(['+919876543210', '+919876511111']);
    expect(page.total).toBe(2);
    expect(page.page).toBe(1);
    expect(page.limit).toBe(20);
  });
});
