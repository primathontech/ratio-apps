import { nothing, render } from 'lit';
import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldRenderCtx } from '../types';
import { renderCheckbox } from './render';

const ctx = (checked = false): FieldRenderCtx => ({
  id: 'rf-consent',
  invalid: nothing,
  describedBy: nothing,
  values: { consent: checked },
  files: {},
  onInput: () => {},
  setValue: () => {},
  ph: (_f, fallback) => fallback,
  adorn: (_f, control) => control,
  requestUpdate: () => {},
  numberFocus: new Set(),
});

function mount(field: ControlFieldOf<'checkbox'>): HTMLElement {
  const host = document.createElement('div');
  render(renderCheckbox(field, ctx()), host);
  return host;
}

const field = (extra: Partial<ControlFieldOf<'checkbox'>> = {}): ControlFieldOf<'checkbox'> =>
  ({
    key: 'consent',
    type: 'checkbox',
    label: 'I agree',
    required: true,
    ...extra,
  }) as ControlFieldOf<'checkbox'>;

describe('renderCheckbox consent tokens', () => {
  it('keeps rendering the legacy single link when no consentText is set', () => {
    const host = mount(
      field({ linkUrl: 'https://example.com/policy', linkText: 'Privacy Policy' }),
    );
    const a = host.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://example.com/policy');
    expect(a.textContent).toBe('Privacy Policy');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('splices {link} tokens into positional anchors', () => {
    const host = mount(
      field({
        consentText: 'I agree to the {link} and the {link2}.',
        links: [
          { text: 'Terms', url: 'https://example.com/terms' },
          { text: 'Privacy', url: 'https://example.com/privacy' },
        ],
      }),
    );
    const anchors = [...host.querySelectorAll('a')] as HTMLAnchorElement[];
    expect(anchors).toHaveLength(2);
    expect(anchors[0]?.getAttribute('href')).toBe('https://example.com/terms');
    expect(anchors[0]?.textContent).toBe('Terms');
    expect(anchors[1]?.getAttribute('href')).toBe('https://example.com/privacy');
    expect(host.querySelector('.rf-consent')?.textContent).toContain('I agree to the');
  });

  it('drops a token that points past the available links', () => {
    const host = mount(
      field({
        consentText: 'See {link} and {link3}.',
        links: [{ text: 'Terms', url: 'https://example.com/terms' }],
      }),
    );
    const anchors = host.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    // The {link3} marker never leaks to the shopper as raw text.
    expect(host.querySelector('.rf-consent')?.textContent).not.toContain('{link3}');
  });

  it('degrades a non-https link to plain text (defense in depth)', () => {
    const host = mount(
      field({
        consentText: 'Read {link}.',
        // intentionally invalid url to exercise the render-time guard
        links: [{ text: 'Terms', url: 'javascript:alert(1)' }] as never,
      }),
    );
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('.rf-consent')?.textContent).toContain('Terms');
  });

  it('gives the box an aria-label from the field label', () => {
    const host = mount(field({ consentText: 'I agree {link}', links: [] }));
    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.getAttribute('aria-label')).toBe('I agree');
  });
});
