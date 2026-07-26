import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderNumber } from './render';

const field = (
  format?: Record<string, unknown>,
  over: Partial<ControlFieldOf<'number'>> = {},
): ControlFieldOf<'number'> =>
  ({
    key: 'n',
    type: 'number',
    label: 'N',
    required: false,
    ...(format ? { format } : {}),
    ...over,
  }) as ControlFieldOf<'number'>;

const makeCtx = (value: unknown, numberFocus = new Set<string>()) => {
  const calls: { key: string; value: unknown }[] = [];
  const ctx = {
    id: 'rf-n',
    invalid: nothing,
    describedBy: nothing,
    values: { n: value } as Record<string, unknown>,
    files: {},
    onInput: () => {},
    setValue: (key: string, v: unknown) => {
      calls.push({ key, value: v });
      ctx.values = { ...ctx.values, [key]: v };
    },
    ph: (_f: unknown, fb: string) => fb,
    adorn: (_f: unknown, c: unknown) => c,
    requestUpdate: () => {},
    numberFocus,
  } as unknown as FieldRenderCtx;
  return { ctx, calls };
};

function mount(f: ControlFieldOf<'number'>, c: FieldRenderCtx): HTMLInputElement {
  const host = document.createElement('div');
  render(renderNumber(f, c), host);
  return host.querySelector('input') as HTMLInputElement;
}

const currency0 = { style: 'currency', currency: 'USD', locale: 'en-US', decimalPlaces: 0 };

describe('renderNumber (Batch-4 formatted variant)', () => {
  it('unformatted field keeps a native number input, unchanged', () => {
    const { ctx } = makeCtx('5');
    const el = mount(field(), ctx);
    expect(el.getAttribute('type')).toBe('number');
  });

  it('blurred shows the Intl string; focused shows the raw canonical value', () => {
    const focus = new Set<string>();
    // Blurred.
    expect(mount(field(currency0), makeCtx('1235', focus).ctx).value).toBe('$1,235');
    // Focused ⇒ editable plain number.
    focus.add('n');
    expect(mount(field(currency0), makeCtx('1235', focus).ctx).value).toBe('1235');
  });

  it('strips letters on input (type=text variant) instead of letting them stick', () => {
    const { ctx, calls } = makeCtx('', new Set(['n']));
    const el = mount(field(currency0), ctx);
    el.value = '12a3';
    el.dispatchEvent(new Event('input'));
    expect(calls.at(-1)?.value).toBe('123');
  });

  it('canonicalizes the stored value on blur so a grouped entry round-trips', () => {
    const { ctx, calls } = makeCtx('1,234', new Set(['n']));
    const el = mount(field({ style: 'decimal', locale: 'en-US' }), ctx);
    el.value = '1,234';
    el.dispatchEvent(new Event('blur'));
    expect(calls.at(-1)?.value).toBe('1234');
  });

  it('rounds to decimalPlaces on blur so display==submit ($1,235 not 1234.56)', () => {
    const { ctx, calls } = makeCtx('1234.56', new Set(['n']));
    const el = mount(field(currency0), ctx);
    el.value = '1234.56';
    el.dispatchEvent(new Event('blur'));
    expect(calls.at(-1)?.value).toBe('1235');
  });

  it('focus display state is scoped to the passed-in set (no module-global leak)', () => {
    const setA = new Set<string>(['n']);
    const setB = new Set<string>();
    // Same field key, two independent form instances: A focused, B not.
    expect(mount(field(currency0), makeCtx('1235', setA).ctx).value).toBe('1235');
    expect(mount(field(currency0), makeCtx('1235', setB).ctx).value).toBe('$1,235');
  });
});
