import { describe, expect, it } from 'vitest';
import { wizzyConfigInputSchema, wizzyConfigSchema } from './wizzy-config';

describe('wizzy-config input schema', () => {
  it('applies storefront defaults when only the minimum is provided', () => {
    const parsed = wizzyConfigInputSchema.parse({});
    expect(parsed.searchEnabled).toBe(false);
    expect(parsed.inputSelector).toBe('#search');
    expect(parsed.resultsMountSelector).toBe('#wizzy-results');
    expect(parsed.resultsPagePath).toBe('/search');
    expect(parsed.themePrimary).toBe('#0fb3a9');
  });

  it('accepts overrides for the storefront fields', () => {
    const parsed = wizzyConfigInputSchema.parse({
      searchEnabled: true,
      inputSelector: '.my-search',
      resultsMountSelector: '#results',
      resultsPagePath: '/find',
      themePrimary: '#ff0000',
    });
    expect(parsed.searchEnabled).toBe(true);
    expect(parsed.inputSelector).toBe('.my-search');
    expect(parsed.resultsMountSelector).toBe('#results');
    expect(parsed.resultsPagePath).toBe('/find');
    expect(parsed.themePrimary).toBe('#ff0000');
  });
});

describe('wizzy-config output schema', () => {
  it('includes the storefront fields in a full output object', () => {
    const value = {
      wizzyEnabled: true,
      storeId: 'store-1',
      hasStoreSecret: true,
      hasApiKey: true,
      needsReconnect: false,
      storeUrl: 'https://example.com',
      lastBulkSyncAt: null,
      autoSyncEnabled: true,
      includeOutOfStock: true,
      stripHtmlDescription: true,
      searchEnabled: true,
      inputSelector: '#search',
      resultsMountSelector: '#wizzy-results',
      resultsPagePath: '/search',
      themePrimary: '#0fb3a9',
    };
    const parsed = wizzyConfigSchema.parse(value);
    expect(parsed.searchEnabled).toBe(true);
    expect(parsed.inputSelector).toBe('#search');
    expect(parsed.resultsMountSelector).toBe('#wizzy-results');
    expect(parsed.resultsPagePath).toBe('/search');
    expect(parsed.themePrimary).toBe('#0fb3a9');
  });
});
