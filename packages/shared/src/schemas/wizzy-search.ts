import { z } from 'zod';

/**
 * Zod schemas mirroring the Wizzy **public** storefront search API
 * (`https://api.wizsearch.in/v1`). These describe the response shapes returned
 * by the autocomplete, search, and trending endpoints, plus the storefront
 * runtime config the SDK is bootstrapped with.
 *
 * Authoritative contract: `packages/wizzy-sdk/docs/wizzy-search-api-contract.md`.
 *
 * Product/suggestion/banner objects are kept permissive (`.passthrough()` /
 * `z.any()`) because Wizzy adds fields over time and the storefront only relies
 * on a typed core subset. The storefront config is `.strict()` so a private
 * `storeSecret` can never leak into the public bundle.
 */

// ─── Product (shared by autocomplete.products[] and search.result[]) ─────────
export const wizzyProductSchema = z
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

export type WizzyProduct = z.infer<typeof wizzyProductSchema>;

// ─── Suggestions (categories / brands / others) ──────────────────────────────
export const wizzySuggestionSchema = z.object({
  value: z.string(),
  payload: z.array(z.any()).default([]),
  filters: z.record(z.string(), z.any()).default({}),
});

export type WizzySuggestion = z.infer<typeof wizzySuggestionSchema>;

/** Page suggestion — CMS pages matched by the query. */
export const wizzyPageSuggestionSchema = z.object({
  value: z.string(),
  filters: z.any().optional(),
});

export type WizzyPageSuggestion = z.infer<typeof wizzyPageSuggestionSchema>;

/** Promo banner — fully permissive; all fields optional. */
export const wizzyBannerSchema = z
  .object({
    desktopImageUrl: z.string().optional(),
    mobileImageUrl: z.string().optional(),
    targetUrl: z.string().optional(),
    displayAs: z.string().optional(),
  })
  .passthrough();

export type WizzyBanner = z.infer<typeof wizzyBannerSchema>;

// ─── Autocomplete (POST /autocomplete) ───────────────────────────────────────
export const wizzyAutocompleteResultSchema = z.object({
  payload: z.object({
    categories: z.array(wizzySuggestionSchema).default([]),
    brands: z.array(wizzySuggestionSchema).default([]),
    others: z.array(wizzySuggestionSchema).default([]),
    pages: z.array(wizzyPageSuggestionSchema).default([]),
    products: z.array(wizzyProductSchema).default([]),
    banners: z.array(wizzyBannerSchema).default([]),
  }),
});

export type WizzyAutocompleteResult = z.infer<typeof wizzyAutocompleteResultSchema>;

// ─── Facets (search.facets[]) ─────────────────────────────────────────────────
/** One selectable option within a list facet — the live API returns these under `data`. */
export const wizzyFacetOptionSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  count: z.number().optional(),
});
export type WizzyFacetOption = z.infer<typeof wizzyFacetOptionSchema>;

export const wizzyFacetSchema = z.object({
  label: z.string(),
  order: z.number().optional(),
  position: z.enum(['left', 'top', 'right']).optional(),
  key: z.string(),
  // Live API returns more than the documented set (e.g. `range-list`, `bool-list`),
  // so keep this permissive rather than a strict enum.
  type: z.string(),
  // The facet's selectable options live here (live API), not in `filterSuggestions`.
  data: z.array(wizzyFacetOptionSchema).default([]),
});

export type WizzyFacet = z.infer<typeof wizzyFacetSchema>;

// ─── Search (POST /products/search) ──────────────────────────────────────────
export const wizzySearchResultSchema = z.object({
  payload: z.object({
    result: z.array(wizzyProductSchema).default([]),
    total: z.number().default(0),
    pages: z.number().default(0),
    facets: z.array(wizzyFacetSchema).default([]),
    filterSuggestions: z.any().optional(),
    filters: z.any().optional(),
    redirectTo: z.string().optional(),
    hasToRedirect: z.boolean().optional(),
  }),
});

export type WizzySearchResult = z.infer<typeof wizzySearchResultSchema>;

// ─── Trending (GET /trendingSearches) ─────────────────────────────────────────
/**
 * Wizzy returns `payload.queries[]`. Items are usually plain strings but may
 * arrive as objects in some catalogs — accept both, defaulting to `string[]`.
 */
export const wizzyTrendingResultSchema = z.object({
  payload: z.object({
    queries: z
      .array(z.union([z.string(), z.object({}).passthrough()]))
      .default([]),
  }),
});

export type WizzyTrendingResult = z.infer<typeof wizzyTrendingResultSchema>;

// ─── Storefront runtime config (bootstrapped into the public SDK) ─────────────
/** Theme — `primary` required; extra keys (e.g. `radius`) allowed as strings. */
export const wizzyThemeSchema = z.object({ primary: z.string() }).catchall(z.string());

export type WizzyTheme = z.infer<typeof wizzyThemeSchema>;

/**
 * Public storefront config. `.strict()` rejects unknown keys so a private
 * `storeSecret` can never be smuggled into the browser bundle.
 */
export const wizzyStorefrontConfigSchema = z
  .object({
    storeId: z.string(),
    apiKey: z.string(),
    version: z.string(),
    inputSelector: z.string(),
    resultsMountSelector: z.string(),
    resultsPagePath: z.string(),
    searchEnabled: z.boolean(),
    theme: wizzyThemeSchema,
  })
  .strict();

export type WizzyStorefrontConfig = z.infer<typeof wizzyStorefrontConfigSchema>;
