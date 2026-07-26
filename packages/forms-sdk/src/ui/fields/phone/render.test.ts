import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderPhone } from './render';

const field = (over: Partial<ControlFieldOf<'phone'>> = {}): ControlFieldOf<'phone'> =>
  ({
    key: 'p',
    type: 'phone',
    label: 'Phone',
    required: false,
    ...over,
  }) as ControlFieldOf<'phone'>;

const makeCtx = (value: unknown) => {
  const calls: { key: string; value: unknown }[] = [];
  const ctx = {
    id: 'rf-p',
    invalid: nothing,
    describedBy: nothing,
    values: { p: value } as Record<string, unknown>,
    files: {},
    onInput: () => {},
    setValue: (key: string, v: unknown) => {
      calls.push({ key, value: v });
      ctx.values = { ...ctx.values, [key]: v };
    },
    ph: (_f: unknown, fb: string) => fb,
    adorn: (_f: unknown, c: unknown) => c,
    requestUpdate: () => {},
    numberFocus: new Set<string>(),
  } as unknown as FieldRenderCtx;
  return { ctx, calls };
};

function mount(f: ControlFieldOf<'phone'>, c: FieldRenderCtx): HTMLElement {
  const host = document.createElement('div');
  render(renderPhone(f, c), host);
  return host;
}

describe('renderPhone single-country (Batch-4 separator fixes)', () => {
  it('has no char-count maxlength that would truncate separators', () => {
    const input = mount(field(), makeCtx('').ctx).querySelector('input') as HTMLInputElement;
    expect(input.hasAttribute('maxlength')).toBe(false);
  });

  it('normalizes typed separators to bare national digits', () => {
    const { ctx, calls } = makeCtx('');
    const input = mount(field(), ctx).querySelector('input') as HTMLInputElement;
    input.value = '98765 43210';
    input.dispatchEvent(new Event('input'));
    expect(calls.at(-1)?.value).toBe('9876543210');
  });
});

describe('renderPhone multi-country (Batch-4 fixes 6–8)', () => {
  const multi = () => field({ countries: { allowed: ['IN', 'GB'], default: 'IN' } });

  it('labels each option with flag + name + dial (same-dial distinguishable)', () => {
    const opts = Array.from(mount(multi(), makeCtx('').ctx).querySelectorAll('option'));
    const gb = opts.find((o) => o.getAttribute('value') === 'GB');
    expect(gb?.textContent).toContain('United Kingdom');
    expect(gb?.textContent).toContain('(+44)');
  });

  it('switches country when a full +international number is pasted into the national input', () => {
    const { ctx, calls } = makeCtx('');
    const input = mount(multi(), ctx).querySelector('input[name="p"]') as HTMLInputElement;
    input.value = '+44 7911 123456';
    input.dispatchEvent(new Event('input'));
    // Country derived (GB) + national digits composed to canonical E.164.
    expect(calls.at(-1)?.value).toBe('+447911123456');
  });

  it('composes national digits under the selected country when no + is present', () => {
    const { ctx, calls } = makeCtx('');
    const input = mount(multi(), ctx).querySelector('input[name="p"]') as HTMLInputElement;
    input.value = '98765 43210';
    input.dispatchEvent(new Event('input'));
    expect(calls.at(-1)?.value).toBe('+919876543210');
  });
});
