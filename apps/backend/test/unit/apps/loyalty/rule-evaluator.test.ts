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

/**
 * Rules grant flat BONUS coins. MULTIPLIER was retired 2026-07-31 — its extra
 * was `(m − 1) × orderTotal × baseEarnRate`, and Core Loyalty owns that rate
 * (it is no longer stored, and Core exposes no endpoint to read it back).
 */
function mkCachedRule(over: Partial<CachedRule> = {}): CachedRule {
  return {
    id: 'rule-1',
    name: 'Flat 100',
    ruleType: 'BONUS',
    value: 100,
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
  });
}

describe('RuleEvaluatorService.selectWinners', () => {
  it('#priority-wins — the higher-priority BONUS beats the rest', () => {
    const winners = run([
      mkCachedRule({ id: 'lo', name: 'Lo', value: 500, priority: 5 }),
      mkCachedRule({ id: 'hi', name: 'Hi', value: 20, priority: 10 }),
    ]);
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('hi');
    expect(winners[0].extraPoints).toBe(20);
  });

  it('equal priority ties break by name for determinism', () => {
    const winners = run([
      mkCachedRule({ id: 'b', name: 'Beta', priority: 5 }),
      mkCachedRule({ id: 'a', name: 'Alpha', priority: 5 }),
    ]);
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('a');
  });

  it('grants the flat value regardless of order total', () => {
    const small = run([mkCachedRule({ value: 75 })], {
      orderFacts: { orderTotal: 5, itemCount: 1, isFirstOrder: false },
    });
    const large = run([mkCachedRule({ value: 75 })], {
      orderFacts: { orderTotal: 50_000, itemCount: 1, isFirstOrder: false },
    });
    expect(small[0].extraPoints).toBe(75);
    expect(large[0].extraPoints).toBe(75);
  });

  it('rounds a fractional bonus value', () => {
    expect(run([mkCachedRule({ value: 2.5 })])[0].extraPoints).toBe(3);
  });

  it('returns at most ONE winner — bonuses no longer stack with a multiplier', () => {
    const winners = run([
      mkCachedRule({ id: 'bonus', name: 'Flat 50', value: 50, priority: 1 }),
      mkCachedRule({ id: 'mult', name: 'Old 2x', ruleType: 'MULTIPLIER', value: 2, priority: 99 }),
    ]);
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('bonus');
  });

  // ── retired MULTIPLIER handling ───────────────────────────────────────────

  it('#skips-retired-multipliers — a legacy MULTIPLIER grants nothing', () => {
    // Awarding a guessed amount would be worse than awarding none: the rate is
    // Core's and unknowable here. The service logs a warning instead.
    const winners = run([mkCachedRule({ id: 'mult', ruleType: 'MULTIPLIER', value: 3 })]);
    expect(winners).toEqual([]);
  });

  it('a matching BONUS still wins when a retired MULTIPLIER is present', () => {
    const winners = run([
      mkCachedRule({ id: 'mult', name: 'Old 3x', ruleType: 'MULTIPLIER', value: 3, priority: 50 }),
      mkCachedRule({ id: 'bonus', name: 'Flat 60', value: 60, priority: 1 }),
    ]);
    expect(winners).toHaveLength(1);
    expect(winners[0].rule.id).toBe('bonus');
    expect(winners[0].extraPoints).toBe(60);
  });

  // ── matching semantics (unchanged) ────────────────────────────────────────

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

  it('list AND segment both matching → the higher-priority one wins', () => {
    const winners = run(
      [
        mkCachedRule({
          id: 'list',
          targetType: 'CUSTOMER_LIST',
          conditions: null,
          priority: 5,
        }),
        mkCachedRule({ id: 'seg', priority: 10, value: 20 }),
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
      mkCachedRule({ id: 'tiny-bonus', value: 0.4 }), // round → 0
    ]);
    expect(winners).toEqual([]);
  });
});
