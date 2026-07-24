import { z } from 'zod';

/**
 * Per-merchant Loyalty app config — the fields the merchant edits in the
 * admin Settings screen. No secrets live here: QR-claim identity is verified
 * via KwikPass tokens server-side and the Core Loyalty API is called with the
 * merchant's OAuth token, so the app needs no vendor API key.
 */
export const loyaltyConfigSchema = z.object({
  /** Display name for points ("Wellversed Coins", "Stars", …). */
  programName: z.string().min(1).max(64).default('Coins'),
  /** Coins earned per ₹1 of order value — the base the rule engine multiplies. */
  baseEarnRate: z.coerce.number().positive().max(1000).default(1),
  /** ₹ value of one coin — drives the outstanding-liability dashboard tile. */
  coinValueInr: z.coerce.number().positive().max(1000).default(0.1),
  /**
   * Merchant storefront origin QR claim links are minted against
   * (`{storefrontBaseUrl}/?loyalty_qr={code}`). Optional at save time; QR
   * creation requires it.
   */
  storefrontBaseUrl: z
    .string()
    .url({ message: 'storefrontBaseUrl must be a valid URL' })
    .optional(),
  /** Default recipient for large-export download links (> 10k rows). */
  exportEmail: z.string().email().optional(),
});

export type LoyaltyConfig = z.infer<typeof loyaltyConfigSchema>;

/** The shape the admin form PUTs — defaults applied server-side. */
export const loyaltyConfigInputSchema = loyaltyConfigSchema;

export type LoyaltyConfigInput = z.input<typeof loyaltyConfigInputSchema>;

/**
 * GET /loyalty-config RESPONSE shape only — adds a presence flag for the
 * per-merchant claim-signing secret used by the QR-claim v2 storefront
 * integration. NEVER extend the input schema with this: the raw secret is
 * revealed/rotated via its own guarded endpoints, never accepted as input.
 */
export const loyaltyConfigResponseSchema = loyaltyConfigSchema.extend({
  /** Whether a claim-signing secret has been generated for this merchant. */
  claimSecretSet: z.boolean(),
});

export type LoyaltyConfigResponse = z.infer<typeof loyaltyConfigResponseSchema>;
