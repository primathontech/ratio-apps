import { z } from 'zod';

/**
 * The coin program's display label.
 *
 * This used to be the per-merchant `programName` config field. Naming, the
 * earning rate, and coin valuation are all owned by the Core Loyalty team, so
 * the app no longer stores them (see ADR-adjacent note in
 * `docs/agent/apps/loyalty/CONTEXT.md`, 2026-07-31).
 *
 * It stays in the WIRE contract (`loyalty-claim.ts`, the public storefront
 * config) filled with this constant, because the deployed `packages/loyalty-sdk`
 * claim widget renders `Earn {points} {programName}` and dropping the field
 * outright would break already-installed storefront script tags. Serve the
 * constant; never accept it as input.
 */
export const LOYALTY_PROGRAM_NAME = 'Coins';

/**
 * Per-merchant Loyalty app config — the fields the merchant edits in the admin
 * Settings screen. No secrets live here: QR-claim identity is verified via
 * KwikPass tokens server-side and the Core Loyalty API is called with the
 * merchant's OAuth token, so the app needs no vendor API key.
 *
 * Deliberately NOT here (owned by Core Loyalty, removed 2026-07-31):
 *   - programName    → {@link LOYALTY_PROGRAM_NAME}
 *   - baseEarnRate   → Core computes order earning; earning rules now grant
 *                      flat BONUS coins, which need no local rate
 *   - coinValueInr   → coin valuation / liability reporting is Core's
 */
export const loyaltyConfigSchema = z.object({
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
