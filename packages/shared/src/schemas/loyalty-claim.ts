import { z } from 'zod';

/**
 * Public QR-claim contract between the loyalty backend and the storefront
 * claim widget (`packages/loyalty-sdk`). Everything here is browser-visible —
 * no secrets, no client-supplied phone (identity comes from the KwikPass
 * token, verified server-side).
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

/** `POST /loyalty/qr/:code/claim` request body — token only, never a phone. */
export const loyaltyClaimRequestSchema = z
  .object({
    gkAccessToken: z.string().min(1).max(4096),
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
  z.object({ status: z.literal('invalid_session') }),
]);

export type LoyaltyClaimResponse = z.infer<typeof loyaltyClaimResponseSchema>;
