import { describe, expect, it, vi } from 'vitest';
import './facet-range';
import type { WizzyFacetRange } from './facet-range';

async function mount() {
  const el = document.createElement('wizzy-facet-range') as WizzyFacetRange;
  el.facetKey = 'sellingPrice';
  el.label = 'Price';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('wizzy-facet-range', () => {
  it('renders min and max number inputs', async () => {
    const el = await mount();
    const inputs = el.shadowRoot!.querySelectorAll('input[type="number"]');
    expect(inputs).toHaveLength(2);
    expect(el.shadowRoot!.textContent ?? '').toContain('Price');
    el.remove();
  });

  it('dispatches wizzy-facet-change with a range on change', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('wizzy-facet-change', (e) => onChange((e as CustomEvent).detail));
    const [min, max] = Array.from(
      el.shadowRoot!.querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[];
    min!.value = '100';
    min!.dispatchEvent(new Event('change', { bubbles: true }));
    max!.value = '900';
    max!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith({
      key: 'sellingPrice',
      range: { gte: 100, lte: 900 },
    });
    el.remove();
  });
});
