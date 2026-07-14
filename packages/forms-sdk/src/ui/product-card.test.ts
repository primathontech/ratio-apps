import { describe, expect, it } from 'vitest';
import './product-card';
import type { FormsProductCard } from './product-card';

const product = {
  id: '1',
  name: 'Wellcore Creatine Monohydrate',
  url: '/p/1',
  mainImage: 'https://x/i.jpg',
  price: 699,
  finalPrice: 588,
  sellingPrice: 588,
  inStock: true,
  discountPercentage: 16,
};

async function mount() {
  const el = document.createElement('forms-product-card') as FormsProductCard;
  el.product = product as never;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('forms-product-card', () => {
  it('renders the name, formatted final price, struck MRP and discount', async () => {
    const el = await mount();
    const text = el.shadowRoot!.textContent ?? '';
    expect(text).toContain('Wellcore Creatine Monohydrate');
    expect(text).toContain('₹588');
    expect(text).toContain('₹699'); // struck MRP, shown because finalPrice < price
    expect(text).toContain('16% off');
    el.remove();
  });
  it('links to the product url', async () => {
    const el = await mount();
    const a = el.shadowRoot!.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/p/1');
    el.remove();
  });
});
