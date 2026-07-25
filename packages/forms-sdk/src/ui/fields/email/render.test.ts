import { html, render as litRender } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderEmail } from './render';

const mk = (val: string, validation?: Record<string, unknown>) => {
  const field = {
    key: 'email',
    type: 'email',
    label: 'Email',
    required: false,
    ...(validation ? { validation } : {}),
  } as ControlFieldOf<'email'>;
  const ctx = {
    id: 'i',
    invalid: 'false',
    describedBy: 'x',
    values: { email: val },
    files: {},
    onInput: () => {},
    setValue: () => {},
    requestUpdate: () => {},
    ph: (_f: unknown, fb: string) => fb,
    adorn: (_f: unknown, c: unknown) => c,
  } as unknown as FieldRenderCtx;
  const host = document.createElement('div');
  // Mimic real placement: control sits among static siblings in the field template.
  litRender(html`<div class="rf-field"><label>L</label>${renderEmail(field, ctx)}</div>`, host);
  return host;
};
describe('renderEmail (native attrs + typo suggestion)', () => {
  it('renders input, reflects maxlength + native attrs', () => {
    const el = mk('').querySelector('input[name="email"][type="email"]') as HTMLInputElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('maxlength')).toBe('254');
    expect(el.getAttribute('autocomplete')).toBe('email');
    expect(el.getAttribute('spellcheck')).toBe('false');
  });
  it('reflects a configured maxlength', () => {
    expect(
      (mk('', { maxLength: 120 }).querySelector('input') as HTMLInputElement).getAttribute(
        'maxlength',
      ),
    ).toBe('120');
  });
  it('shows a typo suggestion and hides it when disabled', () => {
    expect(mk('user@gmial.com').querySelector('.rf-email-suggest')?.textContent).toContain(
      'gmail.com',
    );
    expect(mk('user@gmail.com').querySelector('.rf-email-suggest')).toBeNull();
    expect(
      mk('user@gmial.com', { suggestCorrections: false }).querySelector('.rf-email-suggest'),
    ).toBeNull();
  });
});
