import { z } from 'zod';

/**
 * Loyalty earning-rule condition trees + rule input schema.
 *
 * A SEGMENT rule's `conditions` is a nested AND/OR tree of
 * `{ field, operator, value }` leaves evaluated against the merchant's
 * customer-mirror row and the incoming order payload. The schema lives in
 * `packages/shared` so the admin's visual rule builder and the backend
 * validate identically.
 */

/** Field registry: every condition field, its scope, and its value type. */
export const LOYALTY_CONDITION_FIELDS = {
  // customer-scope — read from the loyalty_customers mirror row
  lifetime_orders: { scope: 'customer', type: 'number' },
  lifetime_spend: { scope: 'customer', type: 'number' },
  points_balance: { scope: 'customer', type: 'number' },
  lifetime_earned: { scope: 'customer', type: 'number' },
  last_order_at: { scope: 'customer', type: 'date' },
  first_seen_source: { scope: 'customer', type: 'enum' },
  // order-scope — read from the orders/create payload
  order_total: { scope: 'order', type: 'number' },
  item_count: { scope: 'order', type: 'number' },
  is_first_order: { scope: 'order', type: 'boolean' },
} as const;

export type LoyaltyConditionField = keyof typeof LOYALTY_CONDITION_FIELDS;

export const LOYALTY_NUMERIC_OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'between',
] as const;
export const LOYALTY_DATE_OPERATORS = ['before', 'after', 'between'] as const;
export const LOYALTY_ENUM_OPERATORS = ['eq', 'neq'] as const;
export const LOYALTY_BOOLEAN_OPERATORS = ['eq'] as const;

export type LoyaltyConditionOperator =
  | (typeof LOYALTY_NUMERIC_OPERATORS)[number]
  | (typeof LOYALTY_DATE_OPERATORS)[number]
  | (typeof LOYALTY_ENUM_OPERATORS)[number];

/** Allowed operators per value type — the leaf schema enforces this pairing. */
const OPERATORS_BY_TYPE: Record<string, readonly string[]> = {
  number: LOYALTY_NUMERIC_OPERATORS,
  date: LOYALTY_DATE_OPERATORS,
  enum: LOYALTY_ENUM_OPERATORS,
  boolean: LOYALTY_BOOLEAN_OPERATORS,
};

export interface LoyaltyConditionLeaf {
  field: LoyaltyConditionField;
  operator: LoyaltyConditionOperator;
  /** number | ISO date string | enum string | boolean | [min, max] tuple for `between`. */
  value: number | string | boolean | [number, number] | [string, string];
}

export interface LoyaltyConditionGroup {
  op: 'AND' | 'OR';
  children: LoyaltyConditionNode[];
}

export type LoyaltyConditionNode = LoyaltyConditionGroup | LoyaltyConditionLeaf;

const leafSchema: z.ZodType<LoyaltyConditionLeaf> = z
  .object({
    field: z.enum(
      Object.keys(LOYALTY_CONDITION_FIELDS) as [LoyaltyConditionField, ...LoyaltyConditionField[]],
    ),
    operator: z.string(),
    value: z.union([
      z.number(),
      z.string(),
      z.boolean(),
      z.tuple([z.number(), z.number()]),
      z.tuple([z.string(), z.string()]),
    ]),
  })
  .superRefine((leaf, ctx) => {
    const meta = LOYALTY_CONDITION_FIELDS[leaf.field];
    const allowed = OPERATORS_BY_TYPE[meta.type] ?? [];
    if (!allowed.includes(leaf.operator)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `operator '${leaf.operator}' not allowed for ${meta.type} field '${leaf.field}'`,
      });
      return;
    }
    const isTuple = Array.isArray(leaf.value);
    if (leaf.operator === 'between' && !isTuple) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'between' requires a [min, max] tuple value`,
      });
    }
    if (leaf.operator !== 'between' && isTuple) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `tuple values are only valid with 'between'`,
      });
    }
    if (meta.type === 'number' && !isTuple && typeof leaf.value !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `field '${leaf.field}' expects a numeric value`,
      });
    }
    if (meta.type === 'boolean' && typeof leaf.value !== 'boolean') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `field '${leaf.field}' expects a boolean value`,
      });
    }
  }) as unknown as z.ZodType<LoyaltyConditionLeaf>;

const groupSchema: z.ZodType<LoyaltyConditionGroup> = z.lazy(() =>
  z.object({
    op: z.enum(['AND', 'OR']),
    children: z.array(conditionNodeSchema).min(1),
  }),
) as unknown as z.ZodType<LoyaltyConditionGroup>;

const conditionNodeSchema: z.ZodType<LoyaltyConditionNode> = z.lazy(() =>
  z.union([groupSchema, leafSchema]),
) as unknown as z.ZodType<LoyaltyConditionNode>;

export const LOYALTY_CONDITION_MAX_DEPTH = 5;
export const LOYALTY_CONDITION_MAX_LEAVES = 30;

function measure(node: LoyaltyConditionNode): { depth: number; leaves: number } {
  if (!('op' in node && 'children' in node)) return { depth: 1, leaves: 1 };
  let depth = 0;
  let leaves = 0;
  for (const child of (node as LoyaltyConditionGroup).children) {
    const m = measure(child);
    depth = Math.max(depth, m.depth);
    leaves += m.leaves;
  }
  return { depth: depth + 1, leaves };
}

/** The full condition tree, size-capped so evaluation stays O(small). */
export const loyaltyRuleConditionSchema: z.ZodType<LoyaltyConditionNode> =
  conditionNodeSchema.superRefine((node, ctx) => {
    const { depth, leaves } = measure(node);
    if (depth > LOYALTY_CONDITION_MAX_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `condition tree exceeds max depth ${LOYALTY_CONDITION_MAX_DEPTH}`,
      });
    }
    if (leaves > LOYALTY_CONDITION_MAX_LEAVES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `condition tree exceeds max leaves ${LOYALTY_CONDITION_MAX_LEAVES}`,
      });
    }
  }) as unknown as z.ZodType<LoyaltyConditionNode>;

/** Admin create/update payload for an earning rule. */
export const loyaltyRuleInputSchema = z
  .object({
    name: z.string().min(1).max(128),
    ruleType: z.enum(['MULTIPLIER', 'BONUS']),
    /** Multiplier (e.g. 3.0, must be > 1 to grant extra) or flat bonus coins. */
    value: z.coerce.number().positive().max(100000),
    targetType: z.enum(['SEGMENT', 'CUSTOMER_LIST']),
    /** Required for SEGMENT targets; ignored for CUSTOMER_LIST. */
    conditions: loyaltyRuleConditionSchema.nullish(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullish(),
    active: z.boolean().default(true),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .superRefine((rule, ctx) => {
    if (rule.targetType === 'SEGMENT' && !rule.conditions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SEGMENT rules require a conditions tree',
        path: ['conditions'],
      });
    }
    if (rule.ruleType === 'MULTIPLIER' && rule.value <= 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MULTIPLIER value must be > 1 (1x grants no extra coins)',
        path: ['value'],
      });
    }
    if (rule.endsAt && rule.endsAt <= rule.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endsAt must be after startsAt',
        path: ['endsAt'],
      });
    }
  });

export type LoyaltyRuleInput = z.infer<typeof loyaltyRuleInputSchema>;
