import { z } from 'zod';
import { eventMapSchema } from './event-map';

/**
 * PostHog API key format check (carried from prototype server.js:56).
 * Format-only — invalid keys still pass; the SDK will fail at PostHog ingestion time.
 */
export const POSTHOG_API_KEY_REGEX = /^phc_[A-Za-z0-9]{20,}$/;

export const posthogApiKeySchema = z.string().regex(POSTHOG_API_KEY_REGEX, {
  message: 'API key must start with phc_ and be at least 24 characters',
});

export const posthogHostSchema = z
  .string()
  .url({ message: 'host must be a valid URL' })
  .refine((url) => url.startsWith('https://'), {
    message: 'host must use https://',
  });

/**
 * The full per-merchant PostHog config — written from the admin form,
 * read back when serving /sdk/:merchantId.js.
 */
export const posthogConfigSchema = z.object({
  apiKey: posthogApiKeySchema,
  host: posthogHostSchema,
  debug: z.boolean().default(false),
  events: eventMapSchema,
});

export type PostHogConfig = z.infer<typeof posthogConfigSchema>;

/**
 * The shape the admin form PUTs to the backend. `events` is optional on
 * submit — backend fills it with defaults if absent (carried from
 * prototype's `normalizeEvents`).
 */
export const posthogConfigInputSchema = posthogConfigSchema.partial({ events: true, debug: true });

export type PostHogConfigInput = z.infer<typeof posthogConfigInputSchema>;
