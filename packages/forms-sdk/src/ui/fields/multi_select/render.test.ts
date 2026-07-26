import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderMultiSelect } from './render';

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
  { value: 'd', label: 'D' },
];

const field = (
  over: Partial<ControlFieldOf<'multi_select'>> = {},
): ControlFieldOf<'multi_select'> =>
  ({
    key: 'm',
    type: 'multi_select',
    label: 'Pick',
    required: false,
    options,
    ...over,
  }) as ControlFieldOf<'multi_select'>;

const ctx = (value: unknown): FieldRenderCtx =>
  ({
    id: 'rf-m',
    invalid: nothing,
    describedBy: nothing,
    values: { m: value },
    files: {},
    onInput: () => {},
    setValue: () => {},
    ph: (_f: unknown, fb: string) => fb,
    adorn: (_f: unknown, c: unknown) => c,
    requestUpdate: () => {},
    numberFocus: new Set(),
  }) as unknown as FieldRenderCtx;

function mount(f: ControlFieldOf<'multi_select'>, c: FieldRenderCtx): HTMLElement {
  const host = document.createElement('div');
  render(renderMultiSelect(f, c), host);
  return host;
}

describe('renderMultiSelect selection count (Batch-4 over-max hint)', () => {
  const count = (host: HTMLElement) => host.querySelector('.rf-selcount')?.textContent ?? '';

  it('shows a plain "N of max selected" within the cap', () => {
    const host = mount(field({ selection: { max: 3 } }), ctx(['a', 'b']));
    expect(count(host)).toContain('2 of 3 selected');
    expect(count(host)).not.toContain('remove');
  });

  it('appends a "— remove N" hint once the count exceeds max', () => {
    const host = mount(field({ selection: { max: 3 } }), ctx(['a', 'b', 'c', 'd']));
    expect(count(host)).toContain('4 of 3 selected');
    expect(count(host)).toContain('remove 1');
  });
});
