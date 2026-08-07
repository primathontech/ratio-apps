import { z } from 'zod';
import { CLEVERTAP_REGIONS } from '../constants/clevertap-events';
import { eventMapSchema } from './event-map';

const CLEVERTAP_REGION_KEYS = Object.keys(CLEVERTAP_REGIONS) as [string, ...string[]];

export const clevertapAccountIdSchema = z
  .string()
  .trim()
  .min(1, 'Account ID is required')
  .max(64, 'Account ID must be at most 64 characters')
  .regex(/^[A-Za-z0-9-]+$/, 'Account ID must be alphanumeric with dashes');

export const clevertapPasscodeSchema = z
  .string()
  .trim()
  .min(1, 'Passcode is required')
  .max(128, 'Passcode must be at most 128 characters');

export const clevertapRegionSchema = z.enum(CLEVERTAP_REGION_KEYS);

export const clevertapCatalogNameSchema = z
  .string()
  .trim()
  .max(128, 'Catalog name must be at most 128 characters');

export const clevertapCatalogEmailSchema = z
  .string()
  .trim()
  .max(255, 'Catalog email must be at most 255 characters')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Catalog email must be a valid email');

export const clevertapConfigSchema = z.object({
  accountId: clevertapAccountIdSchema,
  region: clevertapRegionSchema,
  debug: z.boolean().default(false),
  serverEventsEnabled: z.boolean().default(false),
  events: eventMapSchema,
});

export type ClevertapConfig = z.infer<typeof clevertapConfigSchema>;

export const clevertapConfigInputSchema = clevertapConfigSchema
  .partial({ events: true, debug: true, serverEventsEnabled: true })
  .extend({
    passcode: clevertapPasscodeSchema.or(z.literal('')).optional(),
    catalogName: clevertapCatalogNameSchema.optional(),
    catalogEmail: clevertapCatalogEmailSchema.or(z.literal('')).optional(),
    catalogSyncEnabled: z.boolean().optional(),
    clevertapEnabled: z.boolean().optional(),
    disabledTopics: z.array(z.string()).optional(),
    chargedSource: z.enum(['server', 'client']).optional(),
  })
  .refine((cfg) => !(cfg.serverEventsEnabled === true && cfg.passcode === ''), {
    message: 'cannot enable server-side events while clearing the passcode',
    path: ['serverEventsEnabled'],
  });

export type ClevertapConfigInput = z.infer<typeof clevertapConfigInputSchema>;

export const clevertapConfigOutputSchema = clevertapConfigSchema.extend({
  passcodeSet: z.boolean(),
  catalogName: z.string().optional(),
  catalogEmail: z.string().optional(),
  catalogSyncEnabled: z.boolean().optional(),
  clevertapEnabled: z.boolean(),
  disabledTopics: z.array(z.string()).optional(),
  chargedSource: z.enum(['server', 'client']).optional(),
  lastCatalogSyncAt: z.string().nullable().optional(),
  lastCatalogSyncStatus: z.enum(['sent', 'skipped', 'failed']).nullable().optional(),
  lastCatalogSyncCount: z.number().nullable().optional(),
  lastCatalogSyncError: z.string().nullable().optional(),
});

export type ClevertapConfigOutput = z.infer<typeof clevertapConfigOutputSchema>;
