import { z } from 'zod';

/**
 * Zod schemas mirroring the Forms **public** storefront search API
 * (`https://api.wizsearch.in/v1`). These describe the response shapes returned
 * by the autocomplete, search, and trending endpoints, plus the storefront
 * runtime config the SDK is bootstrapped with.
 *
 * Authoritative contract: `packages/forms-sdk/docs/forms-search-api-contract.md`.
 *
 * Product/suggestion/banner objects are kept permissive (`.passthrough()` /
 * `z.any()`) because Forms adds fields over time and the storefront only relies
 * on a typed core subset. The storefront config is `.strict()` so a private
 * `storeSecret` can never leak into the public bundle.
 */

// ─── Product (shared by autocomplete.products[] and search.result[]) ─────────
export const formsProductSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    mainImage: z.string(),
    hoverImage: z.string().optional(),
    brand: z.string().optional(),
    price: z.number(),
    finalPrice: z.number(),
    sellingPrice: z.number(),
    inStock: z.boolean(),
    discountPercentage: z.number().optional(),
    avgRatings: z.number().optional(),
    totalReviews: z.number().optional(),
  })
  .passthrough();

export type FormsProduct = z.infer<typeof formsProductSchema>;

// ─── Suggestions (categories / brands / others) ──────────────────────────────
export const formsSuggestionSchema = z.object({
  value: z.string(),
  payload: z.array(z.any()).default([]),
  filters: z.record(z.string(), z.any()).default({}),
});

export type FormsSuggestion = z.infer<typeof formsSuggestionSchema>;

/** Page suggestion — CMS pages matched by the query. */
export const formsPageSuggestionSchema = z.object({
  value: z.string(),
  filters: z.any().optional(),
});

export type FormsPageSuggestion = z.infer<typeof formsPageSuggestionSchema>;

/** Promo banner — fully permissive; all fields optional. */
export const formsBannerSchema = z
  .object({
    desktopImageUrl: z.string().optional(),
    mobileImageUrl: z.string().optional(),
    targetUrl: z.string().optional(),
    displayAs: z.string().optional(),
  })
  .passthrough();

export type FormsBanner = z.infer<typeof formsBannerSchema>;

// ─── Autocomplete (POST /autocomplete) ───────────────────────────────────────
export const formsAutocompleteResultSchema = z.object({
  payload: z.object({
    categories: z.array(formsSuggestionSchema).default([]),
    brands: z.array(formsSuggestionSchema).default([]),
    others: z.array(formsSuggestionSchema).default([]),
    pages: z.array(formsPageSuggestionSchema).default([]),
    products: z.array(formsProductSchema).default([]),
    banners: z.array(formsBannerSchema).default([]),
  }),
});

export type FormsAutocompleteResult = z.infer<typeof formsAutocompleteResultSchema>;

// ─── Facets (search.facets[]) ─────────────────────────────────────────────────
/** One selectable option within a list facet — the live API returns these under `data`. */
export const formsFacetOptionSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  count: z.number().optional(),
});
export type FormsFacetOption = z.infer<typeof formsFacetOptionSchema>;

export const formsFacetSchema = z.object({
  label: z.string(),
  order: z.number().optional(),
  position: z.enum(['left', 'top', 'right']).optional(),
  key: z.string(),
  // Live API returns more than the documented set (e.g. `range-list`, `bool-list`),
  // so keep this permissive rather than a strict enum.
  type: z.string(),
  // The facet's selectable options live here (live API), not in `filterSuggestions`.
  data: z.array(formsFacetOptionSchema).default([]),
});

export type FormsFacet = z.infer<typeof formsFacetSchema>;

// ─── Search (POST /products/search) ──────────────────────────────────────────
export const formsSearchResultSchema = z.object({
  payload: z.object({
    result: z.array(formsProductSchema).default([]),
    total: z.number().default(0),
    pages: z.number().default(0),
    facets: z.array(formsFacetSchema).default([]),
    filterSuggestions: z.any().optional(),
    filters: z.any().optional(),
    redirectTo: z.string().optional(),
    hasToRedirect: z.boolean().optional(),
  }),
});

export type FormsSearchResult = z.infer<typeof formsSearchResultSchema>;

// ─── Trending (GET /trendingSearches) ─────────────────────────────────────────
/**
 * Forms returns `payload.queries[]`. Items are usually plain strings but may
 * arrive as objects in some catalogs — accept both, defaulting to `string[]`.
 */
export const formsTrendingResultSchema = z.object({
  payload: z.object({
    queries: z
      .array(z.union([z.string(), z.object({}).passthrough()]))
      .default([]),
  }),
});

export type FormsTrendingResult = z.infer<typeof formsTrendingResultSchema>;

// ─── Storefront runtime config (bootstrapped into the public SDK) ─────────────
/** Theme — `primary` required; extra keys (e.g. `radius`) allowed as strings. */
export const formsThemeSchema = z.object({ primary: z.string() }).catchall(z.string());

export type FormsTheme = z.infer<typeof formsThemeSchema>;

/**
 * Public storefront config. `.strict()` rejects unknown keys so a private
 * `storeSecret` can never be smuggled into the browser bundle.
 */
export const formsStorefrontConfigSchema = z
  .object({
    storeId: z.string(),
    apiKey: z.string(),
    version: z.string(),
    inputSelector: z.string(),
    resultsMountSelector: z.string(),
    resultsPagePath: z.string(),
    searchEnabled: z.boolean(),
    theme: formsThemeSchema,
  })
  .strict();

export type FormsStorefrontConfig = z.infer<typeof formsStorefrontConfigSchema>;
