import { describe, expect, it } from 'vitest';
import { buildCorsOriginChecker, isOriginAllowed } from '../../../src/core/common/cors';

const ALLOWED =
  'http://localhost:5173,https://dev-live-warnings-memphis.trycloudflare.com,https://*.gokwik.io,https://*.gokwik.in';

describe('isOriginAllowed', () => {
  it('accepts an exact-match origin', () => {
    expect(isOriginAllowed('http://localhost:5173', ALLOWED)).toBe(true);
    expect(isOriginAllowed('https://dev-live-warnings-memphis.trycloudflare.com', ALLOWED)).toBe(
      true,
    );
  });

  it('accepts any subdomain of a wildcard suffix', () => {
    expect(isOriginAllowed('https://sandbox-mdashboard.dev.gokwik.in', ALLOWED)).toBe(true);
    expect(isOriginAllowed('https://foo.gokwik.io', ALLOWED)).toBe(true);
  });

  it('rejects a look-alike suffix (no substring bypass)', () => {
    expect(isOriginAllowed('https://evilgokwik.in', ALLOWED)).toBe(false);
    expect(isOriginAllowed('https://gokwik.in.attacker.com', ALLOWED)).toBe(false);
  });

  it('rejects wrong protocol on a wildcard', () => {
    expect(isOriginAllowed('http://foo.gokwik.in', ALLOWED)).toBe(false);
  });

  it('rejects an unlisted origin', () => {
    expect(isOriginAllowed('https://example.com', ALLOWED)).toBe(false);
  });

  it('treats a missing origin as allowed (same-origin / non-browser)', () => {
    expect(isOriginAllowed(undefined, ALLOWED)).toBe(true);
  });
});

describe('buildCorsOriginChecker (parity with isOriginAllowed)', () => {
  const check = (origin: string | undefined): boolean => {
    let allowed = false;
    buildCorsOriginChecker(ALLOWED)(origin, (_e, v) => {
      allowed = v === true;
    });
    return allowed;
  };

  it('matches isOriginAllowed for representative origins', () => {
    for (const o of [
      'http://localhost:5173',
      'https://sandbox-mdashboard.dev.gokwik.in',
      'https://evilgokwik.in',
      'https://example.com',
      undefined,
    ]) {
      expect(check(o)).toBe(isOriginAllowed(o, ALLOWED));
    }
  });
});
