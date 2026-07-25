import { describe, expect, it } from 'vitest';
import {
  HIDDEN_MAX_VALUE_LENGTH,
  HIDDEN_SOURCES,
  readCookieValue,
  resolveHiddenValue,
} from './constants';
import { hiddenFieldSchema } from './schema';

const base = { key: 'utm', type: 'hidden' as const, label: 'UTM source', paramName: 'utm_source' };

const ctx = (over: Partial<Parameters<typeof resolveHiddenValue>[1]> = {}) => ({
  search: '',
  cookie: '',
  referrer: '',
  href: 'https://shop.example/landing?x=1',
  now: new Date('2026-07-26T12:00:00.000Z'),
  ...over,
});

describe('hiddenFieldSchema (source + fallback enrichment)', () => {
  it('accepts a legacy hidden field (paramName only); source stays undefined (url_param at runtime)', () => {
    const r = hiddenFieldSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.source).toBeUndefined();
  });

  it('still requires paramName (unchanged backward-compat contract)', () => {
    const { paramName: _p, ...noParam } = base;
    expect(hiddenFieldSchema.safeParse(noParam).success).toBe(false);
    expect(hiddenFieldSchema.safeParse({ ...base, paramName: '' }).success).toBe(false);
  });

  it('accepts every source enum value', () => {
    for (const source of HIDDEN_SOURCES) {
      expect(hiddenFieldSchema.safeParse({ ...base, source }).success).toBe(true);
    }
  });

  it('rejects an unknown source', () => {
    expect(hiddenFieldSchema.safeParse({ ...base, source: 'geoip' }).success).toBe(false);
  });

  it('accepts bounded constantValue and fallback', () => {
    expect(
      hiddenFieldSchema.safeParse({
        ...base,
        source: 'constant',
        constantValue: 'landing-a',
        fallback: 'unknown',
      }).success,
    ).toBe(true);
  });

  it('rejects an over-long fallback / constantValue (DoS guard)', () => {
    const long = 'x'.repeat(HIDDEN_MAX_VALUE_LENGTH + 1);
    expect(hiddenFieldSchema.safeParse({ ...base, fallback: long }).success).toBe(false);
    expect(hiddenFieldSchema.safeParse({ ...base, constantValue: long }).success).toBe(false);
  });
});

describe('resolveHiddenValue', () => {
  it('reads url_param from the query string', () => {
    expect(resolveHiddenValue(base, ctx({ search: '?utm_source=newsletter' }))).toBe('newsletter');
  });

  it('reads a cookie by paramName', () => {
    expect(
      resolveHiddenValue(
        { ...base, source: 'cookie', paramName: 'sid' },
        ctx({ cookie: 'a=1; sid=abc%20123; b=2' }),
      ),
    ).toBe('abc 123');
  });

  it('returns the referrer / landing_url from context', () => {
    expect(
      resolveHiddenValue(
        { ...base, source: 'referrer' },
        ctx({ referrer: 'https://ref.example/' }),
      ),
    ).toBe('https://ref.example/');
    expect(resolveHiddenValue({ ...base, source: 'landing_url' }, ctx())).toBe(
      'https://shop.example/landing?x=1',
    );
  });

  it('emits an ISO timestamp for the timestamp source', () => {
    expect(resolveHiddenValue({ ...base, source: 'timestamp' }, ctx())).toBe(
      '2026-07-26T12:00:00.000Z',
    );
  });

  it('emits the constantValue for the constant source', () => {
    expect(
      resolveHiddenValue({ ...base, source: 'constant', constantValue: 'promo-x' }, ctx()),
    ).toBe('promo-x');
  });

  it('applies the fallback when the source yields nothing', () => {
    expect(resolveHiddenValue({ ...base, fallback: 'organic' }, ctx({ search: '?other=1' }))).toBe(
      'organic',
    );
  });

  it('returns null when nothing resolves and no fallback is set', () => {
    expect(resolveHiddenValue(base, ctx({ search: '' }))).toBeNull();
  });

  it('clamps a resolved value to the hard ceiling', () => {
    const out = resolveHiddenValue(
      { ...base, source: 'constant', constantValue: 'y'.repeat(HIDDEN_MAX_VALUE_LENGTH + 50) },
      ctx(),
    );
    expect(out).toHaveLength(HIDDEN_MAX_VALUE_LENGTH);
  });
});

describe('readCookieValue', () => {
  it('finds a named cookie and url-decodes it', () => {
    expect(readCookieValue('utm=a%2Bb; x=1', 'utm')).toBe('a+b');
  });
  it('returns null for an absent cookie', () => {
    expect(readCookieValue('x=1', 'utm')).toBeNull();
  });
});
