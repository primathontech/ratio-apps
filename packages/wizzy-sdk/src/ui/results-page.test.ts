import { describe, expect, it, vi } from 'vitest';
import './results-page';
import type { WizzyResultsPage } from './results-page';

const searchResult = {
  payload: {
    result: [
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
    total: 1,
    pages: 1,
    facets: [
      {
        label: 'Brand',
        key: 'brands',
        type: 'list',
        position: 'left',
        order: 1,
        // Live API returns options under `data`, not `filterSuggestions`.
        data: [
          { key: 'Wellcore', label: 'Wellcore', count: 2 },
          { key: 'YouWeFit', label: 'YouWeFit', count: 1 },
        ],
      },
      { label: 'Price', key: 'sellingPrice', type: 'range', position: 'left', order: 2, data: [] },
    ],
  },
};
const filterResult = {
  payload: {
    result: [],
    total: 0,
    pages: 0,
    facets: searchResult.payload.facets,
  },
};
function stubClient() {
  return {
    search: vi.fn(async () => searchResult),
    filter: vi.fn(async () => filterResult),
    event: vi.fn(),
    autocomplete: vi.fn(),
    trending: vi.fn(),
  };
}

async function mount() {
  const el = document.createElement('wizzy-results-page') as WizzyResultsPage;
  el.client = stubClient() as never;
  el.query = 'creatine';
  document.body.appendChild(el);
  await el.updateComplete;
  await el.runSearch();
  await el.updateComplete;
  return el;
}

describe('wizzy-results-page', () => {
  it('runs the search and renders a product grid + total', async () => {
    const el = await mount();
    expect(
      (el.client as unknown as { search: ReturnType<typeof vi.fn> }).search,
    ).toHaveBeenCalledWith('creatine', expect.anything());
    expect(el.shadowRoot!.querySelectorAll('wizzy-product-card')).toHaveLength(1);
    expect(el.shadowRoot!.textContent).toContain('1'); // total count somewhere
    el.remove();
  });

  it('renders a facet-list for the brands facet (values from facet.data) and a facet-range for price', async () => {
    const el = await mount();
    const list = el.shadowRoot!.querySelector('wizzy-facet-list');
    const range = el.shadowRoot!.querySelector('wizzy-facet-range');
    expect(list).not.toBeNull();
    expect(range).not.toBeNull();
    expect((list as unknown as { values: string[] }).values).toEqual(['Wellcore', 'YouWeFit']);
    el.remove();
  });

  it('on a facet change it calls client.filter with the assembled CommonFilter model', async () => {
    const el = await mount();
    el.dispatchEvent(
      new CustomEvent('wizzy-facet-change', {
        detail: { key: 'brands', selected: ['Wellcore'] },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    const filterFn = (el.client as unknown as { filter: ReturnType<typeof vi.fn> }).filter;
    expect(filterFn).toHaveBeenCalled();
    expect(filterFn.mock.calls[0]![0]).toMatchObject({ brands: ['Wellcore'] });
    el.remove();
  });

  it('on a range facet change it includes the range in the filter model', async () => {
    const el = await mount();
    el.dispatchEvent(
      new CustomEvent('wizzy-facet-change', {
        detail: { key: 'sellingPrice', range: { gte: 100, lte: 900 } },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    const filterFn = (el.client as unknown as { filter: ReturnType<typeof vi.fn> }).filter;
    expect(filterFn.mock.calls[0]![0]).toMatchObject({ sellingPrice: [{ gte: 100, lte: 900 }] });
    el.remove();
  });
});
