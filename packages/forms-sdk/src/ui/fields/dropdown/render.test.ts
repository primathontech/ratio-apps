import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx, SelectUiState } from '../types';
import { renderDropdown } from './render';

const options = [
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Pro' },
  { value: 'scale', label: 'Scale' },
];

const field = (over: Partial<ControlFieldOf<'dropdown'>> = {}): ControlFieldOf<'dropdown'> =>
  ({
    key: 'plan',
    type: 'dropdown',
    label: 'Plan',
    required: false,
    options,
    ...over,
  }) as ControlFieldOf<'dropdown'>;

function makeCtx(value: unknown, selectUi: Map<string, SelectUiState>) {
  const calls: { key: string; value: unknown }[] = [];
  const ctx = {
    id: 'rf-plan',
    invalid: nothing,
    describedBy: nothing,
    values: { plan: value },
    files: {},
    onInput: () => {},
    setValue: (key: string, v: unknown) => {
      calls.push({ key, value: v });
      ctx.values[key] = v;
    },
    ph: (_f: unknown, fb: string) => fb,
    adorn: (_f: unknown, c: unknown) => c,
    requestUpdate: () => {},
    numberFocus: new Set<string>(),
    selectUi,
  } as unknown as FieldRenderCtx;
  return { ctx, calls };
}

function mount(f: ControlFieldOf<'dropdown'>, ctx: FieldRenderCtx): HTMLElement {
  const host = document.createElement('div');
  render(renderDropdown(f, ctx), host);
  return host;
}

describe('renderDropdown — native (searchable off)', () => {
  it('renders the prompt and every option', () => {
    const { ctx } = makeCtx('', new Map());
    const host = mount(field({ prompt: 'Pick a plan' }), ctx);
    const opts = [...host.querySelectorAll('option')].map((o) => o.textContent?.trim());
    expect(opts[0]).toBe('Pick a plan');
    expect(opts).toContain('Basic');
    expect(opts).toContain('Pro');
  });

  it('appends an "Other" option and free-text input when allowOther + otherActive', () => {
    const ui = new Map<string, SelectUiState>([['plan', { otherActive: true }]]);
    const { ctx } = makeCtx('', ui);
    const host = mount(field({ allowOther: true, otherLabel: 'Something else' }), ctx);
    const labels = [...host.querySelectorAll('option')].map((o) => o.textContent?.trim());
    expect(labels).toContain('Something else');
    expect(host.querySelector('.rf-other-input')).not.toBeNull();
  });
});

describe('renderDropdown — combobox (searchable on)', () => {
  it('renders an ARIA combobox over a listbox', () => {
    const { ctx } = makeCtx('', new Map());
    const host = mount(field({ searchable: true }), ctx);
    const input = host.querySelector('input[role="combobox"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('ul[role="listbox"]')).not.toBeNull();
  });

  it('filters the option list by the typed query', () => {
    const ui = new Map<string, SelectUiState>([
      ['plan', { open: true, query: 'sc', activeIndex: 0 }],
    ]);
    const { ctx } = makeCtx('', ui);
    const host = mount(field({ searchable: true }), ctx);
    const shown = [...host.querySelectorAll('li[role="option"]')].map((o) => o.textContent?.trim());
    expect(shown).toEqual(['Scale']);
  });

  it('keyboard-selects: ArrowDown then Enter commits the active option', () => {
    const ui = new Map<string, SelectUiState>([['plan', { open: true, activeIndex: 0 }]]);
    const { ctx, calls } = makeCtx('', ui);
    // First render (open at index 0), press ArrowDown to move to index 1.
    let host = mount(field({ searchable: true }), ctx);
    host
      .querySelector('input[role="combobox"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(ui.get('plan')?.activeIndex).toBe(1);
    // Re-render so the handler closes over the new active index, then Enter.
    host = mount(field({ searchable: true }), ctx);
    host
      .querySelector('input[role="combobox"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(calls.at(-1)).toEqual({ key: 'plan', value: 'pro' });
  });

  it('selects an option on mousedown', () => {
    const ui = new Map<string, SelectUiState>([['plan', { open: true, activeIndex: 0 }]]);
    const { ctx, calls } = makeCtx('', ui);
    const host = mount(field({ searchable: true }), ctx);
    const scale = [...host.querySelectorAll('li[role="option"]')].find(
      (o) => o.textContent?.trim() === 'Scale',
    );
    scale?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(calls.at(-1)).toEqual({ key: 'plan', value: 'scale' });
  });
});
