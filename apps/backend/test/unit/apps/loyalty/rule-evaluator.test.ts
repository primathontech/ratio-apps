import { describe, expect, it } from 'vitest';
import type { OrderFacts } from '../../../../src/modules/loyalty/rules/condition-tree';
import type {
  CachedRule,
  CachedRuleSet,
} from '../../../../src/modules/loyalty/rules/rule-cache.service';
import { RuleEvaluatorService } from '../../../../src/modules/loyalty/rules/rule-evaluator.service';
import { mkCustomer } from './helpers/fakes';

const PHONE = '+919876543210';
const NOW = new Date('2026-06-01T00:00:00.000Z');

function mkCachedRule(over: Partial<CachedRule> = {}): CachedRule {
  return {
    id: 'rule-1',
    name: 'Triple points',
    ruleType: 'MULTIPLIER',
    value: 3,
    targetType: 'SEGMENT',
    conditions: { field: 'order_total', operator: 'gt', value: 0 },
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    active: true,
    priority: 0,
    ...over,
  };
}

const facts: OrderFacts = { orderTotal: 1000, itemCount: 2, isFirstOrder: false };

function run(
  rules: CachedRule[],
  over: Partial<{
    listMembership: CachedRuleSet['listMembership'];
    orderFacts: OrderFacts;
    baseEarnRate: number;
    now: Date;
  }> = {},
) {
  const evaluator = new RuleEvaluatorService();
  return evaluator.selectWinners({
    cached: { rules, listMembership: over.listMembership ?? {} },
    customerRow: mkCustomer(),
    orderFacts: over.orderFacts ?? facts,
    phone: PHONE,
    now: over.now ?? NOW,
    baseEarnRate: over.baseEarnRate ?? 1,
  });
}

describe('RuleEvaluatorService.selectWinners', () => {
  it('#priority-wins-per-type — higher-priority MULTIPLIER beats the rest', () => {
    const winners = run([
      mkCachedRule({ id: 'lo', name: 'Lo', value: 5, priority: 5 }),
      mkCachedRule({ id: 'hi', name: 'Hi', value: 2, priority: 10 }),
    ]);
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('hi');
    expect(winners[0].extraPoints).toBe(1000); // (2-1) × 1000 × 1
  });

  it('equal priority ties break by name for determinism', () => {
    const winners = run([
      mkCachedRule({ id: 'b', name: 'Beta', priority: 5 }),
      mkCachedRule({ id: 'a', name: 'Alpha', priority: 5 }),
    ]);
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('a');
  });

  it('#multiplier-and-bonus-stack — one winner per type, both returned', () => {
    const winners = run([
      mkCachedRule({ id: 'mult', value: 2 }),
      mkCachedRule({ id: 'bonus', name: 'Flat 50', ruleType: 'BONUS', value: 50 }),
    ]);
    expect(winners).toHaveLength(2);
    const byId = Object.fromEntries(winners.map((w) => [w.rule.id, w.extraPoints]));
    expect(byId.mult).toBe(1000); // (2-1) × 1000 × 1
    expect(byId.bonus).toBe(50);
  });

  it('rounds multiplier extras with Math.round at .5', () => {
    // (1.5 - 1) × 5 × 1 = 2.5 → 3
    const winners = run([mkCachedRule({ value: 1.5 })], {
      orderFacts: { orderTotal: 5, itemCount: 1, isFirstOrder: false },
    });
    expect(winners[0].extraPoints).toBe(3);
  });

  it('applies baseEarnRate to multiplier extras', () => {
    // (3 - 1) × 1000 × 0.5 = 1000
    const winners = run([mkCachedRule()], { baseEarnRate: 0.5 });
    expect(winners[0].extraPoints).toBe(1000);
  });

  it('excludes inactive rules', () => {
    expect(run([mkCachedRule({ active: false })])).toHaveLength(0);
  });

  it('excludes rules outside their [startsAt, endsAt] window', () => {
    expect(run([mkCachedRule({ startsAt: '2026-07-01T00:00:00.000Z' })])).toHaveLength(0);
    expect(run([mkCachedRule({ endsAt: '2026-05-01T00:00:00.000Z' })])).toHaveLength(0);
    // open-ended window (endsAt null) still matches
    expect(run([mkCachedRule({ endsAt: null })])).toHaveLength(1);
  });

  it('CUSTOMER_LIST matches on embedded membership and skips the tree', () => {
    const listRule = mkCachedRule({
      id: 'list',
      targetType: 'CUSTOMER_LIST',
      conditions: null,
    });
    expect(run([listRule], { listMembership: { list: [PHONE] } })).toHaveLength(1);
    expect(run([listRule], { listMembership: { list: [] } })).toHaveLength(0);
    // null membership (>10k list, unresolved) never matches inside the pure evaluator
    expect(run([listRule], { listMembership: { list: null } })).toHaveLength(0);
  });

  it('list AND segment both matching → one winner per type by priority', () => {
    const winners = run(
      [
        mkCachedRule({
          id: 'list',
          targetType: 'CUSTOMER_LIST',
          conditions: null,
          priority: 5,
        }),
        mkCachedRule({ id: 'seg', priority: 10, value: 2 }),
      ],
      { listMembership: { list: [PHONE] } },
    );
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('seg');
  });

  it('no matching rule → empty array', () => {
    const winners = run([
      mkCachedRule({ conditions: { field: 'order_total', operator: 'gt', value: 5000 } }),
    ]);
    expect(winners).toEqual([]);
  });

  it('winners with extraPoints ≤ 0 are excluded', () => {
    const winners = run([
      mkCachedRule({ id: 'tiny-bonus', ruleType: 'BONUS', value: 0.4 }), // round → 0
    ]);
    expect(winners).toEqual([]);
  });
});
