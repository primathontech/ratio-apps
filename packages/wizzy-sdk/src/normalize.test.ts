import { describe, expect, it } from 'vitest';
// biome-ignore lint/suspicious/noExplicitAny: tests feed raw API-shaped payloads
import { normalizeAutocomplete, normalizeSearch } from './client';

describe('normalizeSearch (live /products/search shape)', () => {
  it('defaults a missing facets key to [] so results-page render() does not crash on .filter', () => {
    // Real API omits payload.facets entirely.
    // biome-ignore lint/suspicious/noExplicitAny: raw shape
    const r = normalizeSearch({ payload: { result: [{ id: '1' }], total: 1, pages: 1 } } as any);
    expect(Array.isArray(r.payload.facets)).toBe(true);
    expect(r.payload.result).toHaveLength(1);
  });
  it('defaults absent result/total/pages', () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw shape
    const r = normalizeSearch({ payload: {} } as any);
    expect(r.payload.result).toEqual([]);
    expect(r.payload.total).toBe(0);
    expect(Array.isArray(r.payload.facets)).toBe(true);
  });
});

describe('normalizeAutocomplete (live /autocomplete shape)', () => {
  it('flattens products object { result: [...] } into a product array', () => {
    // Real API returns payload.products as an OBJECT, not an array.
    // biome-ignore lint/suspicious/noExplicitAny: raw shape
    const r = normalizeAutocomplete({ payload: { products: { result: [{ id: '1' }], total: 1 } } } as any);
    expect(Array.isArray(r.payload.products)).toBe(true);
    expect(r.payload.products).toHaveLength(1);
  });
  it('defaults absent products + suggestion arrays to []', () => {
    // biome-ignore lint/suspicious/noExplicitAny: raw shape
    const r = normalizeAutocomplete({ payload: {} } as any);
    expect(r.payload.products).toEqual([]);
    expect(r.payload.categories).toEqual([]);
    expect(r.payload.others).toEqual([]);
  });
});
