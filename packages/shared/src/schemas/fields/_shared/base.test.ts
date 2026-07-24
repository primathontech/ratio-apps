import { describe, expect, it } from 'vitest';
import {
  formFieldKeySchema,
  hasCatastrophicBacktracking,
  RESERVED_FIELD_KEYS,
  regexPatternSchema,
  usesUnsupportedRegexFeature,
} from './base';

describe('hasCatastrophicBacktracking (P1-1 ReDoS lint)', () => {
  // Known-evil patterns: nested/adjacent unbounded quantifiers.
  const EVIL = [
    '(a+)+$',
    '(a*)*',
    '(a+)*',
    '(a*)+',
    '(.*a){20}',
    '(\\d+)+',
    '([a-z]+)+',
    '((ab)+)+',
    '((a+))+',
    '(a{1,10}){10}',
    '(?:a+)+',
  ];
  it.each(EVIL)('flags %s as catastrophic', (pattern) => {
    expect(hasCatastrophicBacktracking(pattern)).toBe(true);
  });

  // Linear-time shapes that must NOT be rejected.
  const SAFE = [
    '^[A-Za-z ]+$',
    '^\\d{3}-\\d{4}$',
    '[a-z]+@[a-z]+\\.[a-z]+',
    '(abc)+',
    '(a|b|c)+',
    '^[A-Z][a-z]*$',
    'colou?r',
    'a{2,5}',
    '(ab){3}',
    '(a){100}',
  ];
  it.each(SAFE)('allows %s', (pattern) => {
    expect(hasCatastrophicBacktracking(pattern)).toBe(false);
  });
});

describe('usesUnsupportedRegexFeature (P1-1 — RE2-incompatible constructs)', () => {
  // RE2 cannot execute these; they must be rejected at save time.
  const UNSUPPORTED = [
    '(?=foo)bar', // lookahead
    'foo(?!bar)', // negative lookahead
    '(?<=foo)bar', // lookbehind
    '(?<!foo)bar', // negative lookbehind
    '(a)\\1', // numeric backreference
    '(?<year>\\d{4})-\\k<year>', // named backreference
  ];
  it.each(UNSUPPORTED)('flags %s', (pattern) => {
    expect(usesUnsupportedRegexFeature(pattern)).toBe(true);
  });

  // RE2-supported constructs that must NOT be flagged.
  const SUPPORTED = [
    '^[A-Za-z ]+$',
    '(?:ab)+', // non-capturing group
    '(?<year>\\d{4})', // named group (no backref)
    '\\d{3}-\\d{4}', // \d is not a backreference
    '[\\]]', // escaped bracket in a class
    'colou?r',
  ];
  it.each(SUPPORTED)('allows %s', (pattern) => {
    expect(usesUnsupportedRegexFeature(pattern)).toBe(false);
  });
});

describe('regexPatternSchema', () => {
  it('accepts a safe pattern', () => {
    expect(regexPatternSchema.safeParse('^[A-Za-z ]+$').success).toBe(true);
  });

  it('rejects an uncompilable pattern', () => {
    expect(regexPatternSchema.safeParse('(').success).toBe(false);
  });

  it('rejects a catastrophic-backtracking pattern at save time', () => {
    const result = regexPatternSchema.safeParse('(a+)+$');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/catastrophic/);
    }
  });

  it('rejects an RE2-incompatible pattern (lookaround) at save time', () => {
    const result = regexPatternSchema.safeParse('(?=foo)bar');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/unsupported feature/);
    }
  });
});

describe('formFieldKeySchema reserved keys (P2-11)', () => {
  it('rejects the reserved submitted_at key', () => {
    expect(formFieldKeySchema.safeParse('submitted_at').success).toBe(false);
  });

  it.each([...RESERVED_FIELD_KEYS])('rejects reserved key %s', (key) => {
    expect(formFieldKeySchema.safeParse(key).success).toBe(false);
  });

  it('still accepts an ordinary field key', () => {
    expect(formFieldKeySchema.safeParse('submittedAt').success).toBe(true);
    expect(formFieldKeySchema.safeParse('full_name').success).toBe(true);
  });
});
