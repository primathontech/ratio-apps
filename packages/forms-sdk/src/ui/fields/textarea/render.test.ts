import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderTextarea } from './render';

const field = (over: Partial<ControlFieldOf<'textarea'>> = {}): ControlFieldOf<'textarea'> =>
  ({
    key: 'msg',
    type: 'textarea',
    label: 'Message',
    required: false,
    validation: { maxLength: 200 },
    ...over,
  }) as ControlFieldOf<'textarea'>;

const ctx = (value: unknown = ''): FieldRenderCtx =>
  ({
    id: 'f_msg',
    invalid: nothing,
    describedBy: nothing,
    values: { msg: value },
    files: {},
    onInput: () => {},
    setValue: () => {},
    ph: (_f: unknown, fallback: string) => fallback,
    adorn: (_f: unknown, c: unknown) => c,
    requestUpdate: () => {},
  }) as unknown as FieldRenderCtx;

function mount(f: ControlFieldOf<'textarea'>, c: FieldRenderCtx): HTMLTextAreaElement {
  const host = document.createElement('div');
  render(renderTextarea(f, c), host);
  return host.querySelector('textarea') as HTMLTextAreaElement;
}

describe('renderTextarea (Batch-4 field depth)', () => {
  it('defaults to 4 rows and adds no display attrs when unconfigured', () => {
    const ta = mount(field(), ctx());
    expect(ta.getAttribute('rows')).toBe('4');
    expect(ta.hasAttribute('maxlength')).toBe(false);
    expect(ta.hasAttribute('data-mono')).toBe(false);
    expect(ta.getAttribute('style')).toBeFalsy();
  });

  it('reflects minRows into the rows attribute', () => {
    const ta = mount(field({ display: { minRows: 8 } }), ctx());
    expect(ta.getAttribute('rows')).toBe('8');
  });

  it('adds native maxlength only when enforceMaxLength is on', () => {
    expect(
      mount(field({ display: { enforceMaxLength: true } }), ctx()).getAttribute('maxlength'),
    ).toBe('200');
    // Off (soft) → no native cap; the server still hard-enforces maxLength.
    expect(
      mount(field({ display: { enforceMaxLength: false } }), ctx()).hasAttribute('maxlength'),
    ).toBe(false);
  });

  it('applies a monospace font stack + data-mono hook when enabled', () => {
    const ta = mount(field({ display: { monospace: true } }), ctx());
    expect(ta.hasAttribute('data-mono')).toBe(true);
    expect(ta.getAttribute('style') ?? '').toContain('monospace');
  });

  it('clamps auto-grow between a min/max-rows height window', () => {
    const ta = mount(field({ display: { autoGrow: true, minRows: 3, maxRows: 10 } }), ctx());
    const style = ta.getAttribute('style') ?? '';
    expect(style).toContain('min-height');
    expect(style).toContain('max-height');
  });
});
