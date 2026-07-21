import {
  LOYALTY_CONDITION_FIELDS,
  type LoyaltyConditionField,
  type LoyaltyConditionGroup,
  type LoyaltyConditionLeaf,
  type LoyaltyConditionNode,
} from '@ratio-app/shared/schemas/loyalty-rules';
import type { LoyaltyCustomerRow } from '../db/types';

/**
 * Order-scope facts extracted once from the `orders/create` payload and fed to
 * every leaf evaluation alongside the customer mirror row.
 */
export interface OrderFacts {
  orderTotal: number;
  itemCount: number;
  isFirstOrder: boolean;
}

/**
 * Resolve a condition field's current value from (mirror row, order facts).
 * Returns undefined when the value is genuinely missing — the PRD rule is
 * "missing field ⇒ leaf is false", enforced in {@link evaluateLeaf}.
 */
function fieldValue(
  field: LoyaltyConditionField,
  customer: LoyaltyCustomerRow | null,
  order: OrderFacts,
): number | string | boolean | Date | undefined {
  switch (field) {
    case 'lifetime_orders':
      return customer?.lifetimeOrders;
    case 'lifetime_spend':
      return customer ? Number(customer.lifetimeSpend) : undefined;
    case 'points_balance':
      return customer?.pointsBalance;
    case 'lifetime_earned':
      return customer?.lifetimeEarned;
    case 'last_order_at':
      return customer?.lastOrderAt ?? undefined;
    case 'first_seen_source':
      return customer?.firstSeenSource;
    case 'order_total':
      return order.orderTotal;
    case 'item_count':
      return order.itemCount;
    case 'is_first_order':
      return order.isFirstOrder;
    default:
      return undefined;
  }
}

function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function evaluateLeaf(
  leaf: LoyaltyConditionLeaf,
  customer: LoyaltyCustomerRow | null,
  order: OrderFacts,
): boolean {
  const actual = fieldValue(leaf.field, customer, order);
  if (actual === undefined || actual === null) return false;

  const meta = LOYALTY_CONDITION_FIELDS[leaf.field];

  if (meta.type === 'boolean') {
    return leaf.operator === 'eq' && actual === leaf.value;
  }

  if (meta.type === 'enum') {
    if (leaf.operator === 'eq') return actual === leaf.value;
    if (leaf.operator === 'neq') return actual !== leaf.value;
    return false;
  }

  if (meta.type === 'date') {
    const actualT = asTime(actual);
    if (actualT === null) return false;
    if (leaf.operator === 'between' && Array.isArray(leaf.value)) {
      const lo = asTime(leaf.value[0]);
      const hi = asTime(leaf.value[1]);
      return lo !== null && hi !== null && actualT >= lo && actualT <= hi;
    }
    const boundT = asTime(leaf.value);
    if (boundT === null) return false;
    if (leaf.operator === 'before') return actualT < boundT;
    if (leaf.operator === 'after') return actualT > boundT;
    return false;
  }

  // numeric
  const actualN = typeof actual === 'number' ? actual : Number(actual);
  if (Number.isNaN(actualN)) return false;
  if (leaf.operator === 'between' && Array.isArray(leaf.value)) {
    const [lo, hi] = leaf.value as [number, number];
    return actualN >= lo && actualN <= hi;
  }
  const boundN = typeof leaf.value === 'number' ? leaf.value : Number(leaf.value);
  if (Number.isNaN(boundN)) return false;
  switch (leaf.operator) {
    case 'gt':
      return actualN > boundN;
    case 'gte':
      return actualN >= boundN;
    case 'lt':
      return actualN < boundN;
    case 'lte':
      return actualN <= boundN;
    case 'eq':
      return actualN === boundN;
    case 'neq':
      return actualN !== boundN;
    default:
      return false;
  }
}

function isGroup(node: LoyaltyConditionNode): node is LoyaltyConditionGroup {
  return typeof node === 'object' && node !== null && 'op' in node && 'children' in node;
}

/**
 * Recursive, short-circuiting condition-tree evaluation over
 * (customer mirror row, order facts). A missing field value makes its leaf
 * false — never a throw.
 */
export function evaluateConditions(
  node: LoyaltyConditionNode,
  customer: LoyaltyCustomerRow | null,
  order: OrderFacts,
): boolean {
  if (!isGroup(node)) return evaluateLeaf(node, customer, order);
  if (node.op === 'AND') {
    return node.children.every((child) => evaluateConditions(child, customer, order));
  }
  return node.children.some((child) => evaluateConditions(child, customer, order));
}
