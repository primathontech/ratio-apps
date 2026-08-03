import { describe, expect, it, vi } from 'vitest';
import type { RedisService } from '../../../../src/core/cache/redis.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { LoyaltyDatabase } from '../../../../src/modules/loyalty/db/types';
import { RuleCacheService } from '../../../../src/modules/loyalty/rules/rule-cache.service';
import { FakeRedis, MERCHANT_ID } from './helpers/fakes';

const CACHE_KEY = `loyalty:rules:${MERCHANT_ID}`;

function mkRuleDbRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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
    priority: 7,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

/**
 * Chainable Kysely mock: `loyalty_rules` returns the given rows,
 * `loyalty_rule_customers` returns phones per captured `ruleId` where-arg.
 */
function makeDb(
  ruleRows: Record<string, unknown>[],
  phonesByRule: Record<string, { phone: string }[]> = {},
) {
  const calls = { selects: 0 };
  const db = {
    selectFrom(table: string) {
      calls.selects += 1;
      let ruleId: string | undefined;
      let phone: string | undefined;
      const chain = {
        selectAll: () => chain,
        select: () => chain,
        where: (col: string, _op: string, val: unknown) => {
          if (col === 'ruleId') ruleId = val as string;
          if (col === 'phone') phone = val as string;
          return chain;
        },
        limit: () => chain,
        execute: () =>
          Promise.resolve(
            table === 'loyalty_rules' ? ruleRows : (phonesByRule[ruleId ?? ''] ?? []),
          ),
        executeTakeFirst: () =>
          Promise.resolve(
            table === 'loyalty_rule_customers'
              ? (phonesByRule[ruleId ?? ''] ?? []).find((r) => r.phone === phone)
              : undefined,
          ),
      };
      return chain;
    },
  };
  return { handle: { db } as unknown as KyselyClient<LoyaltyDatabase>, calls };
}

function setup(
  ruleRows: Record<string, unknown>[],
  phonesByRule: Record<string, { phone: string }[]> = {},
) {
  const redis = new FakeRedis();
  const { handle, calls } = makeDb(ruleRows, phonesByRule);
  const cache = new RuleCacheService(handle, redis as unknown as RedisService);
  return { cache, redis, calls };
}

describe('RuleCacheService', () => {
  it('miss → DB → setJson with TTL 600 and parses string conditions', async () => {
    const { cache, redis } = setup([mkRuleDbRow()]);
    const spy = vi.spyOn(redis, 'setJson');

    const set = await cache.getActive(MERCHANT_ID);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(CACHE_KEY, expect.anything(), 600);
    expect(set.rules).toHaveLength(1);
    expect(set.rules[0]).toMatchObject({
      id: 'rule-1',
      ruleType: 'MULTIPLIER',
      value: 3,
      active: true,
      priority: 7,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: null,
    });
    expect(set.rules[0].conditions).toEqual({ field: 'order_total', operator: 'gt', value: 500 });
  });

  it('handles conditions arriving as an already-parsed object (mysql2 JSON)', async () => {
    const tree = { field: 'item_count', operator: 'gte', value: 2 };
    const { cache } = setup([mkRuleDbRow({ conditions: tree })]);
    const set = await cache.getActive(MERCHANT_ID);
    expect(set.rules[0].conditions).toEqual(tree);
  });

  it('#cache-hit-skips-db — second getActive does zero rule SQL', async () => {
    const { cache, calls } = setup([mkRuleDbRow()]);
    await cache.getActive(MERCHANT_ID);
    const afterFirst = calls.selects;
    expect(afterFirst).toBeGreaterThan(0);

    const set = await cache.getActive(MERCHANT_ID);
    expect(calls.selects).toBe(afterFirst);
    expect(set.rules).toHaveLength(1);
  });

  it('embeds CUSTOMER_LIST membership per rule in the cached value', async () => {
    const { cache } = setup(
      [
        mkRuleDbRow({
          id: 'rule-2',
          targetType: 'CUSTOMER_LIST',
          ruleType: 'BONUS',
          value: '50.00',
          conditions: null,
        }),
      ],
      { 'rule-2': [{ phone: '+919876543210' }, { phone: '+919876511111' }] },
    );
    const set = await cache.getActive(MERCHANT_ID);
    expect(set.listMembership['rule-2']).toEqual(['+919876543210', '+919876511111']);
    await expect(cache.isInList(set, 'rule-2', '+919876543210')).resolves.toBe(true);
    await expect(cache.isInList(set, 'rule-2', '+910000000000')).resolves.toBe(false);
  });

  it('lists >10k phones are NOT embedded — membership null, isInList checks DB', async () => {
    const bigList = Array.from({ length: 10_001 }, (_, i) => ({
      phone: `+919${String(i).padStart(9, '0')}`,
    }));
    const { cache, calls } = setup(
      [
        mkRuleDbRow({
          id: 'rule-big',
          targetType: 'CUSTOMER_LIST',
          ruleType: 'BONUS',
          value: '50.00',
          conditions: null,
        }),
      ],
      { 'rule-big': bigList },
    );
    const set = await cache.getActive(MERCHANT_ID);
    expect(set.listMembership['rule-big']).toBeNull();

    const before = calls.selects;
    await expect(cache.isInList(set, 'rule-big', bigList[42].phone)).resolves.toBe(true);
    await expect(cache.isInList(set, 'rule-big', '+911111111111')).resolves.toBe(false);
    expect(calls.selects).toBe(before + 2); // membership resolved via DB, not the cache
  });

  it('#mutation-invalidates — invalidate() deletes the cache key', async () => {
    const { cache, redis } = setup([mkRuleDbRow()]);
    const del = vi.spyOn(redis, 'del');

    await cache.getActive(MERCHANT_ID);
    await cache.invalidate(MERCHANT_ID);

    expect(del).toHaveBeenCalledWith(CACHE_KEY);
    expect(redis.store.has(CACHE_KEY)).toBe(false);
  });

  it('#redis-down-falls-back-to-db — disabled Redis means every getActive hits the DB', async () => {
    const { cache, redis, calls } = setup([mkRuleDbRow()]);
    redis.enabled = false;

    const first = await cache.getActive(MERCHANT_ID);
    const afterFirst = calls.selects;
    const second = await cache.getActive(MERCHANT_ID);

    expect(first.rules).toHaveLength(1);
    expect(second.rules).toHaveLength(1);
    expect(calls.selects).toBe(afterFirst * 2);
  });
});
