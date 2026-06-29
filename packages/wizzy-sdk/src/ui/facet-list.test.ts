import { describe, expect, it, vi } from 'vitest';
import './facet-list';
import type { WizzyFacetList } from './facet-list';

async function mount() {
  const el = document.createElement('wizzy-facet-list') as WizzyFacetList;
  el.facetKey = 'brands';
  el.label = 'Brand';
  el.values = ['Wellcore', 'YouWeFit', 'Okami'];
  el.selected = ['Wellcore'];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('wizzy-facet-list', () => {
  it('renders the label and a checkbox per value with current selection checked', async () => {
    const el = await mount();
    const text = el.shadowRoot!.textContent ?? '';
    expect(text).toContain('Brand');
    expect(text).toContain('Wellcore');
    expect(text).toContain('YouWeFit');
    const boxes = el.shadowRoot!.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(3);
    const wellcore = Array.from(boxes).find(
      (b) => (b as HTMLInputElement).value === 'Wellcore',
    ) as HTMLInputElement;
    expect(wellcore.checked).toBe(true);
    el.remove();
  });

  it('dispatches wizzy-facet-change with the new selection on toggle', async () => {
    const el = await mount();
    const onChange = vi.fn();
    el.addEventListener('wizzy-facet-change', (e) => onChange((e as CustomEvent).detail));
    const youwefit = Array.from(el.shadowRoot!.querySelectorAll('input[type="checkbox"]')).find(
      (b) => (b as HTMLInputElement).value === 'YouWeFit',
    ) as HTMLInputElement;
    youwefit.checked = true;
    youwefit.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ key: 'brands', selected: ['Wellcore', 'YouWeFit'] });
    el.remove();
  });
});
