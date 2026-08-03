import { z } from 'zod';

/**
 * How often a merchant's automated bundle generation runs.
 *
 * Deliberately an enum rather than a cron expression: merchants set this from
 * the admin, and accepting arbitrary cron strings would mean shipping a parser,
 * a validator, and the ability for a merchant to set `* * * * *` and exhaust the
 * shared OpenAI budget.
 */
export const fbtSyncFrequencySchema = z.enum(['daily', 'weekly']);
export type FbtSyncFrequency = z.infer<typeof fbtSyncFrequencySchema>;

/**
 * Per-merchant recommendation config, as accepted from the admin.
 *
 * This is the write-side shape. `nextRunAt` / `lastRunAt` are NOT here — they
 * are server-owned scheduling state, never client-supplied.
 */
export const fbtMerchantConfigSchema = z
  .object({
    allowAutomaticRecommendation: z.boolean().default(false),
    recommendationCount: z.number().int().min(1).max(10).default(3),
    syncFrequency: fbtSyncFrequencySchema.default('daily'),
    /** UTC hour of day, 0..23. */
    syncHourUtc: z.number().int().min(0).max(23).default(4),
    /** 0 = Sunday .. 6 = Saturday. Null for daily. */
    syncWeekday: z.number().int().min(0).max(6).nullable().default(null),
    productExcludedList: z.array(z.string()).default([]),
    productsWidgetDisabledList: z.array(z.string()).default([]),
    previewBaseUrl: z.string().url().nullable().default(null),
  })
  .refine((v) => v.syncFrequency !== 'weekly' || v.syncWeekday !== null, {
    message: 'syncWeekday is required when syncFrequency is weekly',
    path: ['syncWeekday'],
  });

export type FbtMerchantConfigInput = z.infer<typeof fbtMerchantConfigSchema>;
