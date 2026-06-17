import { z } from 'zod';

/**
 * Per-merchant Google app config — covers all three integrations (GA4, Google
 * Ads, Google Merchant Center) plus the GMC sync settings. Written from the
 * admin form (`googleConfigInputSchema`), read back redacted
 * (`googleConfigSchema` — the service never returns the GMC service-account key;
 * it exposes `hasGmcKey` instead).
 *
 * Fields are individually optional/nullable and format-validated when present.
 * Cross-field "required when enabled" checks (e.g. a Measurement ID is required
 * once GA4 is enabled) are enforced by the backend's `validate-*` endpoints and
 * at registration time, not here — so a partially-filled draft can still save.
 */

// ─── Field validators ───────────────────────────────────────────────────────
/** GA4 Measurement ID, e.g. `G-XXXXXXXXXX`. */
export const ga4MeasurementIdSchema = z
  .string()
  .regex(/^G-[A-Z0-9]+$/, { message: 'Measurement ID must look like G-XXXXXXXXXX' });

/** Google Ads conversion id — numeric, optionally `AW-`-prefixed (per the SDK). */
export const adsConversionIdSchema = z
  .string()
  .regex(/^(AW-)?\d+$/, { message: 'Conversion ID must be numeric (optionally AW-prefixed)' });

/** Google Merchant Center account id — numeric. */
export const gmcMerchantIdSchema = z
  .string()
  .regex(/^\d+$/, { message: 'Merchant ID must be numeric' });

/** ISO 3166-1 alpha-2 (e.g. `IN`). */
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, { message: 'Country must be a 2-letter ISO code' });

/** ISO 639-1 (e.g. `en`). */
export const languageCodeSchema = z
  .string()
  .regex(/^[a-z]{2}$/, { message: 'Language must be a 2-letter ISO code' });

/** ISO 4217 (e.g. `INR`). */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, { message: 'Currency must be a 3-letter ISO code' });

export const connectionMethodSchema = z.enum(['oauth', 'manual']);
export const gmcConditionSchema = z.enum(['new', 'refurbished', 'used']);
export const gmcCategoryModeSchema = z.enum(['auto', 'default', 'per_type']);
export const pixelStatusSchema = z.enum(['active', 'pending_api', 'error', 'disabled']);

// ─── Input (PUT body the admin form sends) ──────────────────────────────────
/**
 * The shape the admin PUTs. The GMC service-account key is write-only here —
 * `null`/omitted means "leave the stored key unchanged", an empty string means
 * "clear it", a non-empty string sets a new key.
 */
export const googleConfigInputSchema = z.object({
  connectionMethod: connectionMethodSchema.default('manual'),

  // GA4
  ga4Enabled: z.boolean().default(false),
  ga4MeasurementId: ga4MeasurementIdSchema.nullable().optional(),

  // Google Ads
  adsEnabled: z.boolean().default(false),
  adsConversionId: adsConversionIdSchema.nullable().optional(),
  adsConversionLabel: z.string().min(1).max(64).nullable().optional(),
  enhancedConversionsEnabled: z.boolean().default(true),

  // Google Merchant Center
  gmcEnabled: z.boolean().default(false),
  gmcMerchantId: gmcMerchantIdSchema.nullable().optional(),
  /** Write-only service-account JSON key (manual-config path). */
  gmcServiceAccountKey: z.string().nullable().optional(),
  gmcTargetCountry: countryCodeSchema.default('IN'),
  gmcContentLanguage: languageCodeSchema.default('en'),
  gmcCurrency: currencyCodeSchema.default('INR'),
  gmcDefaultCondition: gmcConditionSchema.default('new'),
  gmcBrandOverride: z.string().max(255).nullable().optional(),
  gmcGoogleProductCategory: z.string().max(255).nullable().optional(),
  gmcCategoryMode: gmcCategoryModeSchema.default('default'),

  // Sync settings
  autoSyncEnabled: z.boolean().default(true),
  hourlyReconcileEnabled: z.boolean().default(true),
  syncVariantsEnabled: z.boolean().default(true),
  includeOutOfStock: z.boolean().default(true),
  freeListingsEnabled: z.boolean().default(true),
});

export type GoogleConfigInput = z.infer<typeof googleConfigInputSchema>;

// ─── Output (GET response — secrets redacted) ───────────────────────────────
/**
 * What `GET /google/api/google-config` returns. Mirrors the input minus the
 * write-only secret (replaced by `hasGmcKey`), plus server-owned status fields
 * the admin dashboard renders.
 */
export const googleConfigSchema = z.object({
  connectionMethod: connectionMethodSchema,
  googleAccountEmail: z.string().nullable(),
  /** Whether a GMC service-account key is stored (never the value itself). */
  hasGmcKey: z.boolean(),
  /** True when a Google OAuth refresh has failed and the merchant must reconnect. */
  needsReconnect: z.boolean(),

  ga4Enabled: z.boolean(),
  ga4MeasurementId: z.string().nullable(),
  ga4PixelStatus: pixelStatusSchema,

  adsEnabled: z.boolean(),
  adsConversionId: z.string().nullable(),
  adsConversionLabel: z.string().nullable(),
  adsPixelStatus: pixelStatusSchema,
  enhancedConversionsEnabled: z.boolean(),

  gmcEnabled: z.boolean(),
  gmcMerchantId: z.string().nullable(),
  gmcTargetCountry: z.string(),
  gmcContentLanguage: z.string(),
  gmcCurrency: z.string(),
  gmcDefaultCondition: gmcConditionSchema,
  gmcBrandOverride: z.string().nullable(),
  gmcGoogleProductCategory: z.string().nullable(),
  gmcCategoryMode: gmcCategoryModeSchema,

  autoSyncEnabled: z.boolean(),
  hourlyReconcileEnabled: z.boolean(),
  syncVariantsEnabled: z.boolean(),
  includeOutOfStock: z.boolean(),
  freeListingsEnabled: z.boolean(),
});

export type GoogleConfig = z.infer<typeof googleConfigSchema>;

/** Per-product/variant feed-item status surfaced in the feed-details screen. */
export const feedItemStatusSchema = z.enum(['SYNCED', 'PENDING', 'ERROR', 'WARNING', 'DELETED']);
export type FeedItemStatus = z.infer<typeof feedItemStatusSchema>;

// ─── Discovery contract (OAuth account discovery response) ──────────────────
export const ga4StreamSchema = z.object({
  measurementId: z.string(),
  displayName: z.string().optional(),
  property: z.string().optional(),
});
export const gmcAccountSchema = z.object({
  merchantId: z.string(),
  name: z.string().optional(),
});
export const googleDiscoverResponseSchema = z.object({
  ga4: z.object({ streams: z.array(ga4StreamSchema), error: z.string().optional() }),
  gmc: z.object({ accounts: z.array(gmcAccountSchema), error: z.string().optional() }),
});
export type GoogleDiscoverResponse = z.infer<typeof googleDiscoverResponseSchema>;
