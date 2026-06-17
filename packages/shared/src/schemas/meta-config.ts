import { z } from 'zod';
import {
  DATA_SHARING_LEVELS,
  DEFAULT_DATA_SHARING_LEVEL,
  DEFAULT_PRODUCT_ID_TYPE,
  PRODUCT_ID_TYPES,
} from '../constants/meta-events';
import { eventMapSchema } from './event-map';

/**
 * Per-merchant Meta configuration — written from the admin form, read back
 * when serving /meta/sdk/:merchantId.js and when dispatching CAPI events.
 *
 * Two-layer auth (see docs/TRD-Phase-1-Meta-Events.md §15.1):
 *   - `pixelId`         — public, sent to the browser in the SDK prelude.
 *   - `capiAccessToken` — SECRET, stored encrypted, NEVER sent to the browser;
 *                         used only server-side for the Conversions API.
 */

/** One or more Meta Pixel IDs (numeric strings), comma-separated for multi-pixel. */
export const pixelIdSchema = z
  .string()
  .trim()
  .min(1, { message: 'Pixel ID is required' })
  .regex(/^\d{6,20}(,\s*\d{6,20})*$/, {
    message: 'Pixel ID must be numeric (comma-separated for multiple pixels)',
  });

/** Meta CAPI access token (System User token). Stored encrypted at rest. */
export const capiAccessTokenSchema = z
  .string()
  .trim()
  .min(1, { message: 'CAPI access token is required' });

export const dataSharingLevelSchema = z
  .enum(DATA_SHARING_LEVELS)
  .default(DEFAULT_DATA_SHARING_LEVEL);
export const productIdTypeSchema = z.enum(PRODUCT_ID_TYPES).default(DEFAULT_PRODUCT_ID_TYPE);

/**
 * The full per-merchant Meta config as returned by the API. `capiAccessToken`
 * is returned to the ADMIN only (behind the merchant-token guard); it is
 * stripped before the value is ever placed in the browser SDK prelude.
 */
export const metaConfigSchema = z.object({
  pixelId: pixelIdSchema,
  capiAccessToken: capiAccessTokenSchema,
  dataSharingLevel: dataSharingLevelSchema,
  productIdType: productIdTypeSchema,
  debug: z.boolean().default(false),
  events: eventMapSchema,
});

export type MetaConfig = z.infer<typeof metaConfigSchema>;

/**
 * Shape the admin form PUTs. `events` / `debug` / level / id-type are optional
 * on submit — the backend fills defaults if absent.
 */
export const metaConfigInputSchema = metaConfigSchema.partial({
  events: true,
  debug: true,
  dataSharingLevel: true,
  productIdType: true,
});

export type MetaConfigInput = z.infer<typeof metaConfigInputSchema>;
