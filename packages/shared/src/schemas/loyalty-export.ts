import { z } from 'zod';

/**
 * Customer-mirror filter contract — powers the admin Export screen's filter
 * builder, the customers list/preview, and the export worker's query.
 * Filters are AND-joined (PRD §4.4).
 */

export const LOYALTY_FILTER_FIELDS = [
  'points_balance',
  'lifetime_earned',
  'lifetime_redeemed',
  'lifetime_spend',
  'lifetime_orders',
  'last_order_at',
  'in_rule',
  'scanned_qr',
] as const;

export type LoyaltyFilterField = (typeof LOYALTY_FILTER_FIELDS)[number];

const numericFilterSchema = z.object({
  field: z.enum([
    'points_balance',
    'lifetime_earned',
    'lifetime_redeemed',
    'lifetime_spend',
    'lifetime_orders',
  ]),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'between']),
  value: z.union([z.coerce.number(), z.tuple([z.coerce.number(), z.coerce.number()])]),
});

const dateFilterSchema = z.object({
  field: z.literal('last_order_at'),
  operator: z.enum(['before', 'after', 'between']),
  value: z.union([z.string(), z.tuple([z.string(), z.string()])]),
});

const ruleFilterSchema = z.object({
  field: z.literal('in_rule'),
  operator: z.literal('eq'),
  /** loyalty_rules.id */
  value: z.string().min(1),
});

const qrFilterSchema = z.object({
  field: z.literal('scanned_qr'),
  operator: z.literal('eq'),
  /** loyalty_qr_codes.id */
  value: z.string().min(1),
});

export const loyaltyCustomerFilterSchema = z.union([
  numericFilterSchema,
  dateFilterSchema,
  ruleFilterSchema,
  qrFilterSchema,
]);

export type LoyaltyCustomerFilter = z.infer<typeof loyaltyCustomerFilterSchema>;

export const loyaltyCustomerFiltersSchema = z.array(loyaltyCustomerFilterSchema).max(10);

export type LoyaltyCustomerFilters = z.infer<typeof loyaltyCustomerFiltersSchema>;

/** POST /loyalty/api/exports body. */
export const loyaltyExportRequestSchema = z.object({
  filters: loyaltyCustomerFiltersSchema.default([]),
  /** Required (server-enforced) when the preview count exceeds 10,000. */
  email: z.string().email().optional(),
});

export type LoyaltyExportRequest = z.infer<typeof loyaltyExportRequestSchema>;

/** Row limit above which an export must carry an email (PRD §4.4). */
export const LOYALTY_EXPORT_EMAIL_THRESHOLD = 10_000;
/** Hard cap on export size (gzip CSV in S3; TRD §2c). */
export const LOYALTY_EXPORT_MAX_ROWS = 100_000;
