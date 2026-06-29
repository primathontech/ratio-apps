import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route, test } from '@playwright/test';

// ─── Built bundles (served via page.route, not the network) ───────────────────
const distUrl = (name: string): string =>
  fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
const LOADER = readFileSync(distUrl('__slug__-loader.js'), 'utf8');
const WIDGET = readFileSync(distUrl('__slug__-widget.js'), 'utf8');
const RESULTS = readFileSync(distUrl('__slug__-results.js'), 'utf8');

const JS = 'text/javascript; charset=utf-8';

// ─── Mocked storefront config (matches __slug__StorefrontConfigSchema, strict) ───
const CONFIG = {
  storeId: 'm1',
  apiKey: 'pk_test',
  version: '0.1.0',
  inputSelector: '#search',
  resultsMountSelector: '#__slug__-results',
  resultsPagePath: '/e2e/results.html',
  searchEnabled: true,
  theme: { primary: '#0fb3a9' },
};

function product(id: string, name: string) {
  return {
    id,
    name,
    url: `/products/${id}`,
    mainImage: 'https://example.com/img.png',
    brand: 'Acme',
    price: 1000,
    finalPrice: 800,
    sellingPrice: 800,
    inStock: true,
    discountPercentage: 20,
  };
}

const AUTOCOMPLETE = {
  payload: {
    categories: [{ value: 'Creatine Monohydrate', payload: [], filters: {} }],
    brands: [{ value: 'Acme', payload: [], filters: {} }],
    others: [],
    pages: [],
    products: [product('p1', 'Acme Creatine 250g'), product('p2', 'Acme Creatine 500g')],
    banners: [],
  },
};

const TRENDING = { payload: { queries: ['creatine', 'whey', 'bcaa'] } };

const FACETS = [
  { label: 'Brand', key: 'brand', type: 'list', position: 'left' },
  { label: 'Price', key: 'price', type: 'range', position: 'left' },
];

const SEARCH = {
  payload: {
    result: [
      product('p1', 'Acme Creatine 250g'),
      product('p2', 'Acme Creatine 500g'),
      product('p3', 'Acme Creatine 1kg'),
    ],
    total: 3,
    pages: 1,
    facets: FACETS,
    filterSuggestions: { brand: ['Acme', 'Globex'] },
  },
};

const FILTERED = {
  payload: {
    result: [product('p1', 'Acme Creatine 250g')],
    total: 1,
    pages: 1,
    facets: FACETS,
    filterSuggestions: { brand: ['Acme', 'Globex'] },
  },
};

/** Wire all SDK-asset + __Slug__-API routes onto the page. Returns hit flags. */
async function mockRoutes(page: Page): Promise<{ filterHit: () => boolean }> {
  let filterHit = false;

  const fulfillJs = (route: Route, body: string) => route.fulfill({ contentType: JS, body });

  await page.route('**/__slug__/sdk/__slug__-loader.js*', (r) => fulfillJs(r, LOADER));
  await page.route('**/__slug__/sdk/__slug__-widget.js*', (r) => fulfillJs(r, WIDGET));
  await page.route('**/__slug__/sdk/__slug__-results.js*', (r) => fulfillJs(r, RESULTS));
  await page.route('**/__slug__/sdk/config/*', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(CONFIG) }),
  );

  await page.route('**/api.wizsearch.in/v1/**', (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/autocomplete')) return json(AUTOCOMPLETE);
    if (url.includes('/trendingSearches')) return json(TRENDING);
    if (url.includes('/products/search')) return json(SEARCH);
    if (url.includes('/products/filter')) {
      filterHit = true;
      return json(FILTERED);
    }
    if (url.includes('/events/')) return route.fulfill({ status: 204, body: '' });
    return json({});
  });

  return { filterHit: () => filterHit };
}

test.describe('__Slug__ SDK E2E (built bundles)', () => {
  test('overlay autocomplete', async ({ page }) => {
    await mockRoutes(page);
    await page.goto('/e2e/fixture.html');

    await page.locator('#search').focus();
    await page.locator('#search').fill('crea');

    const overlay = page.locator('__slug__-search-overlay');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    // Open shadow roots are pierced by CSS/text selectors automatically.
    await expect(overlay.getByText('Creatine Monohydrate')).toBeVisible({ timeout: 10_000 });
    await expect(overlay.locator('__slug__-product-card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('submit navigates to results page and renders grid + facets', async ({ page }) => {
    await mockRoutes(page);
    await page.goto('/e2e/fixture.html');

    await page.locator('#search').focus();
    await page.locator('#search').fill('creatine');
    await page.locator('#search').press('Enter');

    await page.waitForURL('**/e2e/results.html?q=creatine', { timeout: 10_000 });

    const resultsPage = page.locator('__slug__-results-page');
    await expect(resultsPage).toBeVisible({ timeout: 10_000 });
    await expect(resultsPage.locator('__slug__-product-card').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(resultsPage.locator('__slug__-facet-list').first()).toBeVisible({ timeout: 10_000 });
  });

  test('facet filter re-queries', async ({ page }) => {
    const { filterHit } = await mockRoutes(page);
    await page.goto('/e2e/results.html?q=creatine');

    const resultsPage = page.locator('__slug__-results-page');
    await expect(resultsPage.locator('__slug__-product-card').first()).toBeVisible({
      timeout: 10_000,
    });
    // 3 products before filtering.
    await expect(resultsPage.locator('__slug__-product-card')).toHaveCount(3, { timeout: 10_000 });

    // Toggle the first brand checkbox inside the list facet.
    const checkbox = resultsPage
      .locator('__slug__-facet-list')
      .first()
      .locator('input[type="checkbox"]')
      .first();
    await checkbox.check();

    // The /products/filter route must have been hit and the grid updated to 1.
    await expect.poll(() => filterHit(), { timeout: 10_000 }).toBe(true);
    await expect(resultsPage.locator('__slug__-product-card')).toHaveCount(1, { timeout: 10_000 });
  });
});
