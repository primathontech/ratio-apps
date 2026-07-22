import { describe, expect, it } from 'vitest';
import {
  compilePattern,
  matchesPattern,
} from '../../../../src/modules/forms/submissions/fields/text/regex-engine';

describe('regex-engine (P1-1 — RE2, backtracking-immune)', () => {
  it('matches a safe pattern correctly', () => {
    expect(matchesPattern('^[a-z]+$', 'abc')).toBe(true);
    expect(matchesPattern('^[a-z]+$', 'abc1')).toBe(false);
    expect(matchesPattern('^\\d{3}-\\d{4}$', '123-4567')).toBe(true);
  });

  it('supports the features forms need (classes, quantifiers, anchors, alternation, groups)', () => {
    expect(compilePattern('^(cat|dog)s?$')).not.toBeNull();
    expect(matchesPattern('^(cat|dog)s?$', 'dogs')).toBe(true);
    expect(matchesPattern('(?:ab)+', 'abab')).toBe(true);
  });

  it('fails closed on a pattern RE2 cannot compile (backreference / lookaround)', () => {
    // These are rejected at save time; if one is ever stored it must reject
    // input rather than throw or run a native regex.
    expect(compilePattern('(a)\\1')).toBeNull();
    expect(compilePattern('(?=foo)bar')).toBeNull();
    expect(matchesPattern('(a)\\1', 'aa')).toBe(false);
  });

  // The core proof: overlapping-alternation exponential ReDoS that the
  // save-time backtracking lint cannot catch. Native RegExp on a ~40-char
  // near-match would explore ~2^40 paths and hang; RE2 returns near-instantly.
  const EVIL: Array<[string, string]> = [
    ['(a|a)+$', `${'a'.repeat(40)}!`],
    ['(a|ab)+$', `${'a'.repeat(40)}c`],
    ['(.*a){20}', `${'a'.repeat(40)}!`],
    ['(a+)+$', `${'a'.repeat(40)}!`],
  ];

  it.each(EVIL)('bounds ReDoS pattern %s on a long near-match input', (pattern, input) => {
    const start = performance.now();
    const result = matchesPattern(pattern, input);
    const elapsedMs = performance.now() - start;
    // The point is that it RETURNS at all (a boolean), and does so in bounded
    // (linear) time instead of hanging the event loop.
    expect(typeof result).toBe('boolean');
    expect(elapsedMs).toBeLessThan(1000);
  });

  it.each([
    ['(a|a)+$', `${'a'.repeat(40)}!`],
    ['(a|ab)+$', `${'a'.repeat(40)}c`],
    ['(a+)+$', `${'a'.repeat(40)}!`],
  ])('anchored ReDoS pattern %s rejects a long non-matching input quickly', (pattern, input) => {
    const start = performance.now();
    expect(matchesPattern(pattern, input)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
