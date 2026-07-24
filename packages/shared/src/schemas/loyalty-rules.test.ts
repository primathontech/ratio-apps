import { describe, expect, it } from 'vitest';
import {
  type LoyaltyConditionGroup,
  type LoyaltyConditionNode,
  loyaltyRuleConditionSchema,
  loyaltyRuleInputSchema,
} from './loyalty-rules';

const leaf = (over: Partial<Record<string, unknown>> = {}): LoyaltyConditionNode =>
  ({ field: 'lifetime_spend', operator: 'gt', value: 50000, ...over }) as LoyaltyConditionNode;

describe('loyaltyRuleConditionSchema', () => {
  it('accepts a single leaf', () => {
    expect(loyaltyRuleConditionSchema.safeParse(leaf()).success).toBe(true);
  });

  it('accepts a nested AND/OR tree', () => {
    const tree: LoyaltyConditionGroup = {
      op: 'AND',
      children: [
        { op: 'OR', children: [leaf(), leaf({ field: 'lifetime_orders', value: 10 })] },
        leaf({ field: 'order_total', operator: 'gte', value: 1000 }),
      ],
    };
    expect(loyaltyRuleConditionSchema.safeParse(tree).success).toBe(true);
  });

  it('accepts between with a tuple and rejects between without one', () => {
    expect(
      loyaltyRuleConditionSchema.safeParse(leaf({ operator: 'between', value: [1, 10] })).success,
    ).toBe(true);
    expect(
      loyaltyRuleConditionSchema.safeParse(leaf({ operator: 'between', value: 5 })).success,
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(loyaltyRuleConditionSchema.safeParse(leaf({ field: 'tags' })).success).toBe(false);
  });

  it('rejects operators not allowed for the field type', () => {
    // gt on enum field
    expect(
      loyaltyRuleConditionSchema.safeParse(
        leaf({ field: 'first_seen_source', operator: 'gt', value: 'qr' }),
      ).success,
    ).toBe(false);
    // before on numeric field
    expect(
      loyaltyRuleConditionSchema.safeParse(leaf({ operator: 'before', value: 5 })).success,
    ).toBe(false);
    // boolean field only takes eq + boolean value
    expect(
      loyaltyRuleConditionSchema.safeParse(
        leaf({ field: 'is_first_order', operator: 'eq', value: true }),
      ).success,
    ).toBe(true);
    expect(
      loyaltyRuleConditionSchema.safeParse(
        leaf({ field: 'is_first_order', operator: 'neq', value: true }),
      ).success,
    ).toBe(false);
  });

  it('rejects empty groups', () => {
    expect(loyaltyRuleConditionSchema.safeParse({ op: 'AND', children: [] }).success).toBe(false);
  });

  it('rejects trees deeper than 5 levels', () => {
    let node: LoyaltyConditionNode = leaf();
    for (let i = 0; i < 6; i++) node = { op: 'AND', children: [node] };
    expect(loyaltyRuleConditionSchema.safeParse(node).success).toBe(false);
  });

  it('rejects trees with more than 30 leaves', () => {
    const tree: LoyaltyConditionGroup = {
      op: 'OR',
      children: Array.from({ length: 31 }, () => leaf()),
    };
    expect(loyaltyRuleConditionSchema.safeParse(tree).success).toBe(false);
  });
});

describe('loyaltyRuleInputSchema', () => {
  const base = {
    name: 'Influencer 3x',
    ruleType: 'MULTIPLIER',
    value: 3,
    targetType: 'CUSTOMER_LIST',
    startsAt: '2026-05-01T00:00:00.000Z',
  };

  it('accepts a minimal CUSTOMER_LIST rule with defaults', () => {
    const parsed = loyaltyRuleInputSchema.parse(base);
    expect(parsed.active).toBe(true);
    expect(parsed.priority).toBe(0);
    expect(parsed.startsAt).toBeInstanceOf(Date);
  });

  it('requires conditions for SEGMENT rules', () => {
    expect(loyaltyRuleInputSchema.safeParse({ ...base, targetType: 'SEGMENT' }).success).toBe(
      false,
    );
    expect(
      loyaltyRuleInputSchema.safeParse({ ...base, targetType: 'SEGMENT', conditions: leaf() })
        .success,
    ).toBe(true);
  });

  it('rejects MULTIPLIER value <= 1 but allows BONUS value of 1', () => {
    expect(loyaltyRuleInputSchema.safeParse({ ...base, value: 1 }).success).toBe(false);
    expect(loyaltyRuleInputSchema.safeParse({ ...base, ruleType: 'BONUS', value: 1 }).success).toBe(
      true,
    );
  });

  it('rejects endsAt before startsAt', () => {
    expect(
      loyaltyRuleInputSchema.safeParse({ ...base, endsAt: '2026-04-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});
