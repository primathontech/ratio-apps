import { describe, expect, it, vi } from 'vitest';
import { requireValue } from '../test-utils';
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
    const root = requireValue(el.shadowRoot, 'facet-range shadow root');
    const inputs = root.querySelectorAll('input[type="number"]');
    expect(inputs).toHaveLength(2);
    expect(root.textContent ?? '').toContain('Price');
    el.remove();
  });

  it('dispatches wizzy-facet-change with a range on change', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('wizzy-facet-change', (e) => onChange((e as CustomEvent).detail));
    const root = requireValue(el.shadowRoot, 'facet-range shadow root');
    const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    const min = requireValue(inputs[0], 'minimum price input');
    const max = requireValue(inputs[1], 'maximum price input');
    min.value = '100';
    min.dispatchEvent(new Event('change', { bubbles: true }));
    max.value = '900';
    max.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith({
      key: 'sellingPrice',
      range: { gte: 100, lte: 900 },
    });
    el.remove();
  });
});
