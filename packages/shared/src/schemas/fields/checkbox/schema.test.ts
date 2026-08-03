import { describe, expect, it } from 'vitest';
import {
  CONSENT_LINK_TEXT_MAX_LENGTH,
  CONSENT_MAX_LINKS,
  CONSENT_TEXT_MAX_LENGTH,
  parseConsentSegments,
} from './constants';
import { checkboxFieldSchema } from './schema';

const base = { key: 'consent', type: 'checkbox' as const, label: 'I agree' };

describe('checkboxFieldSchema (consent enrichment)', () => {
  it('accepts a bare consent box with no new keys (backward compatible)', () => {
    expect(checkboxFieldSchema.safeParse({ ...base }).success).toBe(true);
  });

  it('accepts a legacy single link (linkUrl/linkText) unchanged', () => {
    const r = checkboxFieldSchema.safeParse({
      ...base,
      linkUrl: 'https://example.com/policy',
      linkText: 'Privacy Policy',
    });
    expect(r.success).toBe(true);
  });

  it('accepts consentText with up to CONSENT_MAX_LINKS https links', () => {
    const r = checkboxFieldSchema.safeParse({
      ...base,
      consentText: 'I agree to the {link} and the {link2}.',
      links: [
        { text: 'Terms', url: 'https://example.com/terms' },
        { text: 'Privacy', url: 'https://example.com/privacy' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects consentText over the bound', () => {
    const r = checkboxFieldSchema.safeParse({
      ...base,
      consentText: 'x'.repeat(CONSENT_TEXT_MAX_LENGTH + 1),
    });
    expect(r.success).toBe(false);
  });

  it('rejects more than CONSENT_MAX_LINKS links', () => {
    const link = { text: 'L', url: 'https://example.com/a' };
    const r = checkboxFieldSchema.safeParse({
      ...base,
      links: Array.from({ length: CONSENT_MAX_LINKS + 1 }, () => link),
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-https link url', () => {
    const r = checkboxFieldSchema.safeParse({
      ...base,
      links: [{ text: 'Terms', url: 'http://example.com/terms' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects link text over its bound', () => {
    const r = checkboxFieldSchema.safeParse({
      ...base,
      links: [{ text: 'x'.repeat(CONSENT_LINK_TEXT_MAX_LENGTH + 1), url: 'https://example.com/t' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('parseConsentSegments', () => {
  it('returns a single text segment when there are no tokens', () => {
    expect(parseConsentSegments('I agree')).toEqual([{ kind: 'text', value: 'I agree' }]);
  });

  it('maps {link} and {link1} to index 0, {link2} to 1, {link3} to 2', () => {
    expect(parseConsentSegments('a {link} b {link1} c {link2} d {link3}')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'link', index: 0 },
      { kind: 'text', value: ' b ' },
      { kind: 'link', index: 0 },
      { kind: 'text', value: ' c ' },
      { kind: 'link', index: 1 },
      { kind: 'text', value: ' d ' },
      { kind: 'link', index: 2 },
    ]);
  });

  it('emits link segments for out-of-range tokens (renderer drops them)', () => {
    expect(parseConsentSegments('{link9}')).toEqual([{ kind: 'link', index: 8 }]);
  });
});
