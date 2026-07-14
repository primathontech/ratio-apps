import { beforeEach, describe, expect, it, vi } from 'vitest';
import './search-overlay';
import type { FormsSearchOverlay } from './search-overlay';

const autocompleteResult = {
  payload: {
    categories: [{ value: 'Creatine Monohydrate', payload: [], filters: {} }],
    brands: [],
    others: [{ value: 'Creatine Dynamite', payload: [], filters: {} }],
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
};
const trendingResult = { payload: { queries: ['creatine', 'pre-workout'] } };

function stubClient() {
  return {
    autocomplete: vi.fn(async () => autocompleteResult),
    trending: vi.fn(async () => trendingResult),
    search: vi.fn(),
    filter: vi.fn(),
    event: vi.fn(),
  };
}
function stubRecent(items: string[]) {
  return { list: () => items, add: vi.fn(), remove: vi.fn(), clear: vi.fn() };
}

async function mount(recent: string[]) {
  const el = document.createElement('forms-search-overlay') as FormsSearchOverlay;
  el.client = stubClient() as never;
  el.recent = stubRecent(recent) as never;
  el.open = true;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('forms-search-overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('empty state shows recent searches and trending searches', async () => {
    const el = await mount(['bcaa']);
    // allow the trending fetch microtasks to settle
    await el.loadEmptyState();
    await el.updateComplete;
    const text = el.shadowRoot!.textContent ?? '';
    expect(text.toLowerCase()).toContain('recent');
    expect(text).toContain('bcaa');
    expect(text.toLowerCase()).toContain('trending');
    expect(text).toContain('creatine');
    el.remove();
  });

  it('typing fetches autocomplete and renders categories, suggestions and products', async () => {
    vi.useFakeTimers();
    const el = await mount([]);
    el.onInput('crea');
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    await el.updateComplete;
    const text = el.shadowRoot!.textContent ?? '';
    expect(text).toContain('Creatine Monohydrate'); // category
    expect(text).toContain('Creatine Dynamite'); // suggestion (others)
    expect(text).toContain('Wellcore Creatine'); // product
    el.remove();
  });

  it('submit dispatches a forms-submit event with the query', async () => {
    const el = await mount([]);
    const onSubmit = vi.fn();
    el.addEventListener('forms-submit', (e) => onSubmit((e as CustomEvent).detail));
    el.submit('creatine');
    expect(onSubmit).toHaveBeenCalledWith({ q: 'creatine' });
    el.remove();
  });

  it('clicking a category suggestion submits its value', async () => {
    vi.useFakeTimers();
    const el = await mount([]);
    el.onInput('crea');
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    await el.updateComplete;
    const onSubmit = vi.fn();
    el.addEventListener('forms-submit', (e) => onSubmit((e as CustomEvent).detail));
    const cat = Array.from(el.shadowRoot!.querySelectorAll('button, a')).find((n) =>
      (n.textContent ?? '').includes('Creatine Monohydrate'),
    ) as HTMLElement;
    cat.click();
    expect(onSubmit).toHaveBeenCalledWith({ q: 'Creatine Monohydrate' });
    el.remove();
  });
});
