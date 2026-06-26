import { describe, expect, it } from 'vitest';
import {
  wizzyAutocompleteResultSchema,
  wizzySearchResultSchema,
  wizzyStorefrontConfigSchema,
} from './wizzy-search';

describe('wizzy-search schemas', () => {
  it('parses an autocomplete payload', () => {
    const r = wizzyAutocompleteResultSchema.parse({
      payload: {
        categories: [{ value: 'Creatine Monohydrate', payload: [], filters: {} }],
        others: [{ value: 'Creatine Dynamite', payload: [], filters: {} }],
        brands: [],
        pages: [],
        banners: [],
        products: [
          {
            id: '1',
            name: 'Wellcore Creatine',
            url: '/p/1',
            mainImage: 'https://x/i.jpg',
            price: 699,
            finalPrice: 588,
            sellingPrice: 588,
            inStock: true,
          },
        ],
      },
    });
    expect(r.payload.products[0]?.sellingPrice).toBe(588);
    expect(r.payload.categories[0]?.value).toBe('Creatine Monohydrate');
  });

  it('parses a search payload with facets', () => {
    const r = wizzySearchResultSchema.parse({
      payload: {
        result: [],
        total: 0,
        pages: 0,
        facets: [{ label: 'Brand', key: 'brands', type: 'list', position: 'left', order: 1 }],
      },
    });
    expect(r.payload.facets[0]?.key).toBe('brands');
  });

  it('parses storefront config and rejects a stray secret', () => {
    const c = wizzyStorefrontConfigSchema.parse({
      storeId: 's1',
      apiKey: 'pub',
      version: '0.1.0',
      inputSelector: '#search',
      resultsMountSelector: '#results',
      resultsPagePath: '/search',
      searchEnabled: true,
      theme: { primary: '#0fb3a9' },
    });
    expect(c).not.toHaveProperty('storeSecret');
    expect(() =>
      wizzyStorefrontConfigSchema.parse({
        storeId: 's1',
        apiKey: 'pub',
        version: '0.1.0',
        inputSelector: '#search',
        resultsMountSelector: '#results',
        resultsPagePath: '/search',
        searchEnabled: true,
        theme: { primary: '#0fb3a9' },
        storeSecret: 'LEAK',
      }),
    ).toThrow();
  });
});
