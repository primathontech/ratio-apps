import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderUrl } from './render';

const field = (): ControlFieldOf<'url'> =>
  ({ key: 'u', type: 'url', label: 'URL', required: false }) as ControlFieldOf<'url'>;

const makeCtx = (value: unknown) => {
  const calls: { key: string; value: unknown }[] = [];
  const ctx = {
    id: 'rf-u',
    invalid: nothing,
    describedBy: nothing,
    values: { u: value } as Record<string, unknown>,
    files: {},
    onInput: () => {},
    setValue: (key: string, v: unknown) => calls.push({ key, value: v }),
    ph: (_f: unknown, fb: string) => fb,
    adorn: (_f: unknown, c: unknown) => c,
    requestUpdate: () => {},
    numberFocus: new Set<string>(),
  } as unknown as FieldRenderCtx;
  return { ctx, calls };
};

function mount(c: FieldRenderCtx): HTMLInputElement {
  const host = document.createElement('div');
  render(renderUrl(field(), c), host);
  return host.querySelector('input') as HTMLInputElement;
}

describe('renderUrl (Batch-4 blur trim)', () => {
  // NOTE: a native type=url input applies the HTML value-sanitization algorithm
  // (strips leading/trailing whitespace) on assignment, so we assert on the DOM
  // value seen after blur rather than round-tripping raw whitespace through it.
  it('leaves no surrounding whitespace in the input value after blur', () => {
    const { ctx } = makeCtx('');
    const el = mount(ctx);
    el.value = '  https://example.com  ';
    el.dispatchEvent(new Event('blur'));
    expect(el.value).toBe('https://example.com');
  });

  it('wires @blur and no-ops on an already-clean value (no redundant setValue)', () => {
    const { ctx, calls } = makeCtx('https://example.com');
    const el = mount(ctx);
    el.value = 'https://example.com';
    el.dispatchEvent(new Event('blur'));
    expect(calls.length).toBe(0);
  });
});
