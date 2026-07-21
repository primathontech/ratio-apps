import { z } from 'zod';

/**
 * Public QR-claim contract between the loyalty backend and the storefront
 * claim widget (`packages/loyalty-sdk`). Identity is resolved by the
 * storefront BFF (never by our backend): the BFF looks up the verified
 * phone and signs `${merchantId}.${qr}.${phone}.${ts}` with the merchant's
 * claim-signing secret (HMAC-SHA256, hex digest). Our backend never sees a
 * KwikPass/GoKwik token — it only recomputes and constant-time-compares the
 * signature against `loyalty_configs.claimSigningSecret`. Everything here is
 * browser-visible — no secrets travel in the request/response bodies.
 */

/** Redacted public config served at `GET /loyalty/sdk/config/:merchantId`. */
export const loyaltyPublicConfigSchema = z
  .object({
    programName: z.string(),
    enabled: z.boolean(),
    version: z.string(),
  })
  .strict();

export type LoyaltyPublicConfig = z.infer<typeof loyaltyPublicConfigSchema>;

/** QR campaign states the claim widget renders. */
export const loyaltyQrStateSchema = z.enum([
  'active',
  'not_started',
  'expired',
  'paused',
  'fully_claimed',
]);

export type LoyaltyQrState = z.infer<typeof loyaltyQrStateSchema>;

/** `GET /loyalty/qr/:code/status` response. */
export const loyaltyQrStatusSchema = z.object({
  state: loyaltyQrStateSchema,
  eventName: z.string(),
  points: z.number(),
  programName: z.string(),
  claimMessage: z.string().optional(),
});

export type LoyaltyQrStatus = z.infer<typeof loyaltyQrStatusSchema>;

/** `POST /loyalty/qr/:code/claim` request — a per-merchant SIGNED claim.
 * The storefront BFF resolves the verified phone and signs
 * `${merchantId}.${qr}.${phone}.${ts}` with the merchant's claim secret.
 * Our backend never sees a KwikPass token or a client-supplied unsigned phone. */
export const loyaltyClaimRequestSchema = z
  .object({
    merchantId: z.string().min(1).max(128),
    phone: z.string().min(1).max(20),
    ts: z.number().int().positive(),
    sig: z.string().min(1).max(256),
  })
  .strict();

export type LoyaltyClaimRequest = z.infer<typeof loyaltyClaimRequestSchema>;

/** `POST /loyalty/qr/:code/claim` response. */
export const loyaltyClaimResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('credited'),
    points: z.number(),
    newBalance: z.number(),
    programName: z.string(),
  }),
  z.object({
    status: z.literal('already_claimed'),
    balance: z.number(),
    programName: z.string(),
  }),
  z.object({
    status: z.literal('unavailable'),
    state: loyaltyQrStateSchema,
  }),
  z.object({ status: z.literal('invalid_signature') }),
]);

export type LoyaltyClaimResponse = z.infer<typeof loyaltyClaimResponseSchema>;
