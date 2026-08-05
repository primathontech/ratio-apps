import { z } from 'zod';

/**
 * Bundle wire contract, shared by the backend and `admin-fbt`.
 *
 * Enum values are fixed by the `fbt_bundles` DDL and match the source app's
 * TypeORM enums exactly — changing one means a migration, not a schema edit.
 */
export const fbtBundleStatusSchema = z.enum(['draft', 'published', 'paused', 'archived']);
export type FbtBundleStatusValue = z.infer<typeof fbtBundleStatusSchema>;

export const fbtScopeTypeSchema = z.enum([
  'all_products',
  'specific_product',
  'specific_collections',
]);
export type FbtScopeTypeValue = z.infer<typeof fbtScopeTypeSchema>;

export const fbtBundleModeSchema = z.enum(['auto', 'manual']);
export type FbtBundleModeValue = z.infer<typeof fbtBundleModeSchema>;

/** ISO-8601 datetime string, or null for "unbounded". */
const isoDate = z.string().datetime().nullable().default(null);

/**
 * Create/update body for a bundle.
 *
 * `mode` is absent by design: the admin only ever writes manual bundles, and
 * the sweep (Plan 3) is the only writer of `mode: 'auto'`. Accepting it here
 * would let a merchant relabel an auto bundle and have the next sweep clobber
 * their edit.
 */
export const fbtBundleInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    status: fbtBundleStatusSchema.default('draft'),
    scopeType: fbtScopeTypeSchema,
    scopeProductIds: z.array(z.string().min(1)).nullable().default(null),
    scopeCollectionIds: z.array(z.string().min(1)).nullable().default(null),
    startDate: isoDate,
    endDate: isoDate,
    recommendationCount: z.number().int().min(1).max(10).nullable().default(null),
    /** Widget layout/theme for this bundle. Free-form: the SDK owns its shape. */
    uiConfig: z.record(z.string(), z.unknown()),
    /** Per-card overrides keyed by product id. */
    perCardConfig: z.record(z.string(), z.unknown()).nullable().default(null),
  })
  .refine((v) => v.scopeType !== 'specific_product' || (v.scopeProductIds?.length ?? 0) > 0, {
    message: 'scopeProductIds is required when scopeType is specific_product',
    path: ['scopeProductIds'],
  })
  .refine(
    (v) => v.scopeType !== 'specific_collections' || (v.scopeCollectionIds?.length ?? 0) > 0,
    {
      message: 'scopeCollectionIds is required when scopeType is specific_collections',
      path: ['scopeCollectionIds'],
    },
  )
  .refine(
    (v) =>
      !v.startDate ||
      !v.endDate ||
      new Date(v.startDate).getTime() <= new Date(v.endDate).getTime(),
    {
      message: 'endDate must not be earlier than startDate',
      path: ['endDate'],
    },
  );

export type FbtBundleInput = z.infer<typeof fbtBundleInputSchema>;

/** API response shape. Server-owned fields are present here but not on input. */
export const fbtBundleOutputSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  name: z.string(),
  status: fbtBundleStatusSchema,
  scopeType: fbtScopeTypeSchema,
  scopeProductIds: z.array(z.string()).nullable(),
  scopeCollectionIds: z.array(z.string()).nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  recommendationCount: z.number().int().nullable(),
  recommendationProductList: z.array(z.string()).nullable(),
  uiConfig: z.record(z.string(), z.unknown()),
  perCardConfig: z.record(z.string(), z.unknown()).nullable(),
  mode: fbtBundleModeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FbtBundleOutput = z.infer<typeof fbtBundleOutputSchema>;

/** Body for `POST /fbt/api/bundles/duplicate`. */
export const fbtDuplicateBundleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});
export type FbtDuplicateBundleInput = z.infer<typeof fbtDuplicateBundleSchema>;

/** Body for `POST /fbt/api/bundles/:id/status`. */
export const fbtSetBundleStatusSchema = z.object({ status: fbtBundleStatusSchema });
export type FbtSetBundleStatusInput = z.infer<typeof fbtSetBundleStatusSchema>;
