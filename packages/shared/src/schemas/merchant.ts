import { z } from 'zod';

/**
 * Merchant identity. `id` is the Ratio merchant_id (received in the OAuth token
 * exchange response) — used directly as our primary key. No internal UUID layer.
 * Format varies between sandbox and production; never validate as UUID.
 */
export const merchantSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
  installedAt: z.coerce.date(),
  uninstalledAt: z.coerce.date().nullable(),
});

export type Merchant = z.infer<typeof merchantSchema>;

/**
 * Response shape of Ratio's POST /api/v1/oauth/token.
 * - `merchant_id` is Ratio's merchant identifier (becomes our merchants.id)
 * - `scope` is comma-separated ("read_orders,read_products")
 * - `merchantStoreId` may or may not be present depending on platform version
 */
export const ratioOauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().min(1),
  merchant_id: z.string().min(1),
});

export type RatioOauthTokenResponse = z.infer<typeof ratioOauthTokenResponseSchema>;
