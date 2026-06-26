# Wizzy Storefront Search API — extracted contract (from docs.api.wizzy.ai/specs.json, Swagger 2.0)

Base URL: `https://api.wizsearch.in/v1`  (same host as catalog client)

## Auth (public vs private)
- **Public endpoints** (search/autocomplete/trending/events): headers `x-store-id` + `x-api-key` ONLY.
  - **MUST NOT send `x-store-secret` on public endpoints.**
  - CORS is wildcard → browser-safe to call directly.
- Optional headers: `x-request-id`, `x-wizzy-userId` (end-user id, ≤100 chars), `x-wizzy-tags` (comma-separated segmentation).
- Private endpoints (catalog /products/save etc.) additionally need `x-store-secret`.

## POST /autocomplete  (Catalogue Suggestions)  — powers the typing overlay
Body (formData): `q`* (string), `suggestionsCount` (1–20, def 10), `productsCount` (0–10, def 0 → set >0 to get top products),
`minQueryLength` (1–6, def 3), `minLastWordLength` (1–6, def 3), `includeOutOfStock` (bool), `getAllVariants` ("true"/"false"),
`showOOSProductsInOrder`, `currency` (ISO 4217), `sort`, `swatch`, `sections`, `facets`, `inventorySources`, `hasToReturnBanners`.
Response `payload`:
- `categories[]`, `brands[]`, `others[]` — each a Suggestion: `{ value, payload:[{key,value}], filters:{categories[],brands[],colors[],genders[],attributes[]} }`
- `pages[]` — PageSuggestion: `{ value, filters:{ pages:{id,title,url,slug} } }`
- `products[]` — full product objects (see Product shape below)
- `banners[]` — promo banners `{ desktopImageUrl, mobileImageUrl, targetUrl, displayAs, ... }`

→ Screenshot mapping: CATEGORIES column = `categories`; suggestion queries = `others`/`brands`; TOP PRODUCTS = `products`.

## POST /products/search  (Search Products)  — powers the full results page
Body (formData): `q`* , `productsCount`, `minQueryLength`, `minLastWordLength`, `includeOutOfStock`,
`hasToConsiderQueryRedirects`, `getAllVariants`, `variantsGroup`, `variantsGroupBy`, `showOOSProductsInOrder`,
`ignoreEmptyFacets`, `enforcePriceRangeFromQuery`, `currency`, `sort`, `swatch`, `facets`, `inventorySources`,
`attributeFacetValuesLimit`, `includeSwatchInAttributeFacets`, `hasToReturnBanners`.
Response `payload`: `result[]` (products), `total`, `pages`, `facets[]` ({label,order,position:left|top,key,type:list|range|dictionary}),
`hasToRedirect`/`redirectTo`, `filterSuggestions{...}`, `filters{ page, type:DEFAULT|CATEGORY_PAGE|AUTOCOMPLETE_OPTION|AUTOCOMPLETE_DEFAULT|NO_RESULTS_FOUND, productsCount, currency, q, ... }`.

## POST /products/filter  (Filter Products) — paginated/faceted listing
Body (formData): `filters`* = JSON string of the **filter model** (CommonFilter).
Filter model (CommonFilter): `categories[]`, `brands[]`, `colors[]`, `sizes[]`, `genders[]`,
`attributes{key:[vals]}`, `floatAttributes{key:[{lte,gte}]}`, `datetimeAttributes{...}`, `groupIds[]`,
`sellingPrice:[{lte,gte}]`, `price`, `finalPrice`, `avgRatings`, `discount`, `discountPercentage`,
`inStock:[bool]`, `getAllVariants`, `showOOSProductsInOrder`, `hasToReturnBanners`.
(The filter request also carries page/q/productsCount/facets like search.)

## Facets request (CommonFacetsField) — what facets to compute
Array of `{ key, label?, order?, position:left|right, buckets:[{from,to}]?, config:{interval,limit}? }`
key enum: `all|categories|brands|sellingPrice|genders|colors|sizes|avgRatings|discountPercentage|inStock|attributes|"Attribute ID:Attribute Type"`.

## GET /trendingSearches — powers "TRENDING SEARCHES"
Query: `size`. Response `payload.queries[]`.

## Events (analytics) — POST /events/click, /events/view, /events/converted
Body schemas (productId / query / userId etc.) — fire from SDK for personalization + trending.

## Product object (shared by autocomplete.products[], search.result[])
`id, name, url, mainImage, hoverImage, brand, sku[], description, inStock, stockQty,
price, finalPrice, sellingPrice, discount, discountPercentage,
categories[], colors[], sizes[], attributes[], images[], videos[],
totalReviews, avgRatings, gender, groupId, childData{}, inventorySources[], createdAt, updatedAt`.
Prices are floats (rupees). `sellingPrice` = price after discount; `price` = MRP.
