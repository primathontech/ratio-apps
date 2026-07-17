import { z } from 'zod';

/**
 * Per-merchant Delhivery Direct (carrier) config — the fields the merchant
 * edits on the admin Config screen. The `apiToken` is the merchant's own
 * Delhivery Express B2C token (`Authorization: Token <apiToken>`); it is
 * encrypted at rest by the backend and NEVER returned in plaintext.
 */

/** Delhivery Express B2C API token — opaque upstream format, just non-empty. */
export const delhiveryApiTokenSchema = z.string().min(1, {
  message: 'API token is required',
});

/** Daily manifest/pickup cutoff — strict 24h `HH:mm` (IST). */
export const delhiveryPickupCutoffSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'pickupCutoff must be HH:mm (24h)' });

/** When the AWB is created: on `orders/paid` (auto) or from the admin (manual). */
export const delhiveryAwbTriggerSchema = z.enum(['auto', 'manual']);

/** Fallback box dimensions (cm) used when product dimension metafields are absent. */
export const delhiveryDefaultBoxSchema = z.object({
  l: z.number().int().positive({ message: 'box length must be a positive integer (cm)' }),
  b: z.number().int().positive({ message: 'box breadth must be a positive integer (cm)' }),
  h: z.number().int().positive({ message: 'box height must be a positive integer (cm)' }),
});

/**
 * The full per-merchant Delhivery config as the backend understands it.
 */
export const delhiveryConfigSchema = z.object({
  apiToken: delhiveryApiTokenSchema,
  /** Delhivery-registered warehouse name — acts as warehouse id + RTO destination. */
  pickupLocationName: z.string().min(1, { message: 'pickup location name is required' }),
  /**
   * Pickup warehouse pincode. Registered with Delhivery as the warehouse `pin`
   * AND used as the `origin_pin` for the Expected TAT (delivery-estimate) API.
   */
  pickupPincode: z.string().regex(/^\d{6}$/, { message: 'pickup pincode must be 6 digits' }),
  /** Pickup warehouse contact number → Delhivery warehouse `phone`. */
  pickupPhone: z.string().regex(/^\d{10}$/, { message: 'pickup phone must be 10 digits' }),
  /** Pickup warehouse address → Delhivery warehouse `address` + `return_address` (RTO dest). */
  pickupAddress: z
    .string()
    .min(1, { message: 'pickup address is required' })
    .max(512, { message: 'pickup address must be at most 512 characters' }),
  /** Pickup warehouse city (optional). Max aligns with the pickup_city column. */
  pickupCity: z.string().max(128, { message: 'pickup city must be at most 128 characters' }).default(''),
  /** Seller GSTIN → Delhivery `seller_gst_tin`. */
  gstin: z.string().min(1, { message: 'GSTIN is required' }).max(20),
  pickupCutoff: delhiveryPickupCutoffSchema.default('10:00'),
  awbTrigger: delhiveryAwbTriggerSchema.default('auto'),
  defaultBox: delhiveryDefaultBoxSchema,
  /** Per-merchant kill switch. */
  enabled: z.boolean().default(true),
});

export type DelhiveryConfig = z.infer<typeof delhiveryConfigSchema>;

/**
 * The shape the admin form PUTs to the backend. `pickupCutoff` / `awbTrigger`
 * / `enabled` may be omitted on submit — the backend fills the defaults.
 */
export const delhiveryConfigInputSchema = delhiveryConfigSchema
  .partial({
    pickupCutoff: true,
    awbTrigger: true,
    enabled: true,
  })
  // Token is write-only, so the form can't round-trip it: blank keeps the
  // stored token, non-empty replaces it. Required only on first setup — the
  // backend enforces that (DelhiveryConfigService.upsert), not the schema.
  .extend({ apiToken: z.string().optional() });

export type DelhiveryConfigInput = z.infer<typeof delhiveryConfigInputSchema>;
