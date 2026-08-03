import type { LoyaltyConditionNode } from '@ratio-app/shared/schemas/loyalty-rules';
import { describe, expect, it } from 'vitest';
import {
  evaluateConditions,
  type OrderFacts,
} from '../../../../src/modules/loyalty/rules/condition-tree';
import { mkCustomer } from './helpers/fakes';

const order: OrderFacts = { orderTotal: 1500, itemCount: 3, isFirstOrder: false };

const leaf = (over: Record<string, unknown>): LoyaltyConditionNode =>
  ({ field: 'lifetime_spend', operator: 'gt', value: 50000, ...over }) as LoyaltyConditionNode;

describe('evaluateConditions', () => {
  const vip = mkCustomer({ lifetimeSpend: '60000.00', lifetimeOrders: 12, pointsBalance: 5000 });

  it('evaluates numeric operators against customer-scope fields', () => {
    expect(evaluateConditions(leaf({}), vip, order)).toBe(true);
    expect(evaluateConditions(leaf({ operator: 'lt' }), vip, order)).toBe(false);
    expect(
      evaluateConditions(
        leaf({ field: 'lifetime_orders', operator: 'gte', value: 12 }),
        vip,
        order,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'points_balance', operator: 'eq', value: 5000 }),
        vip,
        order,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'points_balance', operator: 'neq', value: 5000 }),
        vip,
        order,
      ),
    ).toBe(false);
  });

  it('evaluates between with an inclusive tuple', () => {
    expect(
      evaluateConditions(
        leaf({ field: 'order_total', operator: 'between', value: [1000, 1500] }),
        vip,
        order,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'order_total', operator: 'between', value: [1501, 2000] }),
        vip,
        order,
      ),
    ).toBe(false);
  });

  it('evaluates order-scope fields from order facts', () => {
    expect(
      evaluateConditions(leaf({ field: 'item_count', operator: 'gte', value: 3 }), vip, order),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'is_first_order', operator: 'eq', value: false }),
        vip,
        order,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'is_first_order', operator: 'eq', value: true }),
        vip,
        order,
      ),
    ).toBe(false);
  });

  it('evaluates date operators on last_order_at', () => {
    const c = mkCustomer({ lastOrderAt: new Date('2026-06-01T00:00:00Z') });
    expect(
      evaluateConditions(
        leaf({ field: 'last_order_at', operator: 'after', value: '2026-01-01T00:00:00Z' }),
        c,
        order,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'last_order_at', operator: 'before', value: '2026-01-01T00:00:00Z' }),
        c,
        order,
      ),
    ).toBe(false);
  });

  it('treats missing field values as false (PRD rule), never throws', () => {
    // No mirror row at all → customer-scope leaves are false.
    expect(evaluateConditions(leaf({}), null, order)).toBe(false);
    // Mirror row without a last order → date leaf is false.
    expect(
      evaluateConditions(
        leaf({ field: 'last_order_at', operator: 'after', value: '2026-01-01' }),
        mkCustomer({ lastOrderAt: null }),
        order,
      ),
    ).toBe(false);
  });

  it('evaluates nested AND/OR groups: (spend>50k OR orders>=10) AND order_total>1000', () => {
    const tree: LoyaltyConditionNode = {
      op: 'AND',
      children: [
        {
          op: 'OR',
          children: [leaf({}), leaf({ field: 'lifetime_orders', operator: 'gte', value: 10 })],
        },
        leaf({ field: 'order_total', operator: 'gt', value: 1000 }),
      ],
    };
    expect(evaluateConditions(tree, vip, order)).toBe(true);
    // Fails the AND when order_total drops below the bound.
    expect(evaluateConditions(tree, vip, { ...order, orderTotal: 900 })).toBe(false);
    // OR side: spend too low but orders qualify.
    const modest = mkCustomer({ lifetimeSpend: '100.00', lifetimeOrders: 11 });
    expect(evaluateConditions(tree, modest, order)).toBe(true);
    // Neither OR branch holds.
    const newbie = mkCustomer({ lifetimeSpend: '100.00', lifetimeOrders: 1 });
    expect(evaluateConditions(tree, newbie, order)).toBe(false);
  });

  it('evaluates enum eq/neq on first_seen_source', () => {
    const qrCustomer = mkCustomer({ firstSeenSource: 'qr' });
    expect(
      evaluateConditions(
        leaf({ field: 'first_seen_source', operator: 'eq', value: 'qr' }),
        qrCustomer,
        order,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        leaf({ field: 'first_seen_source', operator: 'neq', value: 'qr' }),
        qrCustomer,
        order,
      ),
    ).toBe(false);
  });
});
