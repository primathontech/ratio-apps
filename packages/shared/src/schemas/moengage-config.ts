import { z } from 'zod';
import { MOENGAGE_DATA_CENTERS } from '../constants/moengage-events';
import { eventMapSchema } from './event-map';

const MOENGAGE_DATA_CENTER_KEYS = Object.keys(MOENGAGE_DATA_CENTERS) as [string, ...string[]];

export const moengageAppIdSchema = z
  .string()
  .trim()
  .min(1, 'App ID is required')
  .max(64, 'App ID must be at most 64 characters')
  .regex(/^[A-Z0-9_]+$/, 'App ID must be uppercase alphanumeric with underscores');

export const moengageSwPathSchema = z
  .string()
  .max(255, 'Service worker path must be at most 255 characters')
  .regex(/^\/[A-Za-z0-9_\-./]*$/, 'must be a same-origin path starting with /')
  .or(z.literal(''));

export const moengageConfigSchema = z.object({
  appId: moengageAppIdSchema,
  dataCenter: z.enum(MOENGAGE_DATA_CENTER_KEYS),
  debug: z.boolean().default(false),
  swPath: moengageSwPathSchema.default(''),
  events: eventMapSchema,
});

export type MoEngageConfig = z.infer<typeof moengageConfigSchema>;

/**
 * Admin form → backend PUT body shape. `events`, `debug`, `swPath` are
 * optional; backend fills with defaults when absent.
 */
export const moengageConfigInputSchema = moengageConfigSchema.partial({
  events: true,
  debug: true,
  swPath: true,
});

export type MoEngageConfigInput = z.infer<typeof moengageConfigInputSchema>;
