import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx, SelectUiState } from '../types';
import { renderRadio } from './render';

const options = [
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Pro' },
];

const field = (over: Partial<ControlFieldOf<'radio'>> = {}): ControlFieldOf<'radio'> =>
  ({
    key: 'plan',
    type: 'radio',
    label: 'Plan',
    required: false,
    options,
    ...over,
  }) as ControlFieldOf<'radio'>;

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

function mount(f: ControlFieldOf<'radio'>, ctx: FieldRenderCtx): HTMLElement {
  const host = document.createElement('div');
  render(renderRadio(f, ctx), host);
  return host;
}

const group = (host: HTMLElement) => host.querySelector('[role="radiogroup"]');

describe('renderRadio — layout / variant', () => {
  it('keeps today (vertical/list) with no data-layout/data-variant attributes', () => {
    const { ctx } = makeCtx('', new Map());
    const g = group(mount(field(), ctx));
    expect(g?.getAttribute('data-layout')).toBeNull();
    expect(g?.getAttribute('data-variant')).toBeNull();
  });

  it('reflects layout=grid with an inline bounded column count', () => {
    const { ctx } = makeCtx('', new Map());
    const g = group(mount(field({ layout: 'grid', gridColumns: 3 }), ctx));
    expect(g?.getAttribute('data-layout')).toBe('grid');
    expect(g?.getAttribute('style')).toContain('repeat(3,minmax(0,1fr))');
  });

  it('reflects variant=card', () => {
    const { ctx } = makeCtx('', new Map());
    const g = group(mount(field({ variant: 'card' }), ctx));
    expect(g?.getAttribute('data-variant')).toBe('card');
  });
});

describe('renderRadio — "Other"', () => {
  it('appends an Other radio and reveals a free-text input when active', () => {
    const ui = new Map<string, SelectUiState>([['plan', { otherActive: true }]]);
    const { ctx } = makeCtx('', ui);
    const host = mount(field({ allowOther: true, otherLabel: 'Custom' }), ctx);
    const labels = [...host.querySelectorAll('.rf-check-text')].map((s) => s.textContent?.trim());
    expect(labels).toContain('Custom');
    expect(host.querySelector('.rf-other-input')).not.toBeNull();
  });

  it('treats a persisted non-option value as Other mode', () => {
    const { ctx } = makeCtx('my typed value', new Map());
    const host = mount(field({ allowOther: true }), ctx);
    const other = host.querySelector('.rf-other-input') as HTMLInputElement | null;
    expect(other?.value).toBe('my typed value');
  });
});
