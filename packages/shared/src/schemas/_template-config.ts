import { z } from 'zod';
import { eventMapSchema } from './event-map';

// TEMPLATE: This is an example per-merchant config schema. Replace `apiKey` /
// `host` / `events` with the fields your vendor actually needs and tighten the
// validation (e.g. a vendor-specific key prefix regex) to match.
/**
 * Example API key check — accept any non-empty string. Tighten this to your
 * vendor's real key format (e.g. a required prefix) when you customize.
 */
export const _templateApiKeySchema = z.string().min(1, {
  message: 'API key is required',
});

export const _templateHostSchema = z
  .string()
  .url({ message: 'host must be a valid URL' })
  .refine((url) => url.startsWith('https://'), {
    message: 'host must use https://',
  });

/**
 * The full per-merchant Template config — written from the admin form,
 * read back when serving /sdk/:merchantId.js.
 */
export const _templateConfigSchema = z.object({
  apiKey: _templateApiKeySchema,
  host: _templateHostSchema,
  debug: z.boolean().default(false),
  events: eventMapSchema,
});

export type TemplateConfig = z.infer<typeof _templateConfigSchema>;

/**
 * The shape the admin form PUTs to the backend. `events` is optional on
 * submit — backend fills it with defaults if absent (carried from
 * prototype's `normalizeEvents`).
 */
export const _templateConfigInputSchema = _templateConfigSchema.partial({
  events: true,
  debug: true,
});

export type TemplateConfigInput = z.infer<typeof _templateConfigInputSchema>;
