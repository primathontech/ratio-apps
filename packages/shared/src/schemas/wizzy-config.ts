import { z } from 'zod';

/**
 * Per-merchant Wizzy (AI Search & Discovery) config. The merchant connects with
 * a Wizzy **Store ID** + **Store Secret** (the secret is write-only — encrypted
 * at rest, never returned; reads expose `hasStoreSecret` instead), picks the SDK
 * URL, and toggles sync behaviour. Mirrors the `google` app's config contract.
 *
 * Fields are individually optional/nullable and format-validated when present so
 * a partially-filled draft can still save; "required when enabled" checks live in
 * the backend's validate endpoint, not here.
 */

// ─── Field validators ───────────────────────────────────────────────────────
/** Wizzy Store ID — alphanumeric/dash token from the Wizzy dashboard. */
export const wizzyStoreIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, {
    message: 'Store ID must be alphanumeric (dashes/underscores allowed)',
  })
  .max(128);

/** SDK script URL injected via the ScriptTag API. */
export const sdkUrlSchema = z.string().url().max(512);

/**
 * Storefront URL/domain used to build absolute product links
 * (`https://<host>/products/<handle>`). Accepts a full URL or a bare host —
 * normalized server-side. Lenient on format so a draft can still save.
 */
export const wizzyStoreUrlSchema = z.string().max(512);

export const scriptTagStatusSchema = z.enum(['active', 'pending_api', 'error', 'disabled']);

// ─── Input (PUT body the admin form sends) ──────────────────────────────────
/**
 * The shape the admin PUTs. `storeSecret` is write-only — `null`/omitted means
 * "leave the stored secret unchanged", an empty string means "clear it", a
 * non-empty string sets a new secret.
 */
export const wizzyConfigInputSchema = z.object({
  wizzyEnabled: z.boolean().default(false),
  storeId: wizzyStoreIdSchema.nullable().optional(),
  /** Write-only Wizzy Store Secret (catalog API auth). */
  storeSecret: z.string().nullable().optional(),
  /** Write-only Wizzy API Key (catalog API auth — required alongside storeSecret). */
  apiKey: z.string().nullable().optional(),
  sdkUrl: sdkUrlSchema.default('https://cdn.wizzy.ai/sdk/v2/wizzy.min.js'),
  /** Storefront URL/domain — builds absolute product links in the Wizzy feed. */
  storeUrl: wizzyStoreUrlSchema.nullable().optional(),

  // Sync settings
  autoSyncEnabled: z.boolean().default(true),
  includeOutOfStock: z.boolean().default(true),
  stripHtmlDescription: z.boolean().default(true),

  // Storefront search SDK settings (plain, not secret)
  /** Master switch for the storefront search SDK. */
  searchEnabled: z.boolean().default(false),
  /** CSS selector of the storefront search input. */
  inputSelector: z.string().max(255).default('#search'),
  /** CSS selector where the results page mounts. */
  resultsMountSelector: z.string().max(255).default('#wizzy-results'),
  /** Path of the results page. */
  resultsPagePath: z.string().max(255).default('/search'),
  /** Primary theme color. */
  themePrimary: z.string().max(32).default('#0fb3a9'),
});

export type WizzyConfigInput = z.infer<typeof wizzyConfigInputSchema>;

// ─── Output (GET response — secrets redacted) ───────────────────────────────
/**
 * What `GET /wizzy/api/wizzy-config` returns. Mirrors the input minus the
 * write-only secret (replaced by `hasStoreSecret`), plus server-owned status
 * fields the admin dashboard renders.
 */
export const wizzyConfigSchema = z.object({
  wizzyEnabled: z.boolean(),
  storeId: z.string().nullable(),
  /** Whether a Store Secret is stored (never the value itself). */
  hasStoreSecret: z.boolean(),
  /** Whether an API Key is stored (never the value itself). */
  hasApiKey: z.boolean(),
  /** True when the merchant must reconnect (Ratio OAuth refresh failed). */
  needsReconnect: z.boolean(),

  sdkUrl: z.string(),
  /** Storefront URL/domain (echoed back; used for product links). */
  storeUrl: z.string().nullable(),
  scriptTagStatus: scriptTagStatusSchema,
  lastBulkSyncAt: z.string().nullable(),

  autoSyncEnabled: z.boolean(),
  includeOutOfStock: z.boolean(),
  stripHtmlDescription: z.boolean(),

  // Storefront search SDK settings (plain, echoed back)
  /** Master switch for the storefront search SDK. */
  searchEnabled: z.boolean(),
  /** CSS selector of the storefront search input. */
  inputSelector: z.string(),
  /** CSS selector where the results page mounts. */
  resultsMountSelector: z.string(),
  /** Path of the results page. */
  resultsPagePath: z.string(),
  /** Primary theme color. */
  themePrimary: z.string(),
});

export type WizzyConfig = z.infer<typeof wizzyConfigSchema>;

/** Per-product catalog-item status surfaced in the catalog-details screen. */
export const wizzyCatalogStatusSchema = z.enum(['SYNCED', 'PENDING', 'ERROR', 'DELETED']);
export type WizzyCatalogStatus = z.infer<typeof wizzyCatalogStatusSchema>;
