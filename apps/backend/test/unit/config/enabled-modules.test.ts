import { describe, expect, it } from 'vitest';
import { resolveEnabledModules } from '../../../src/config/enabled-modules';
import { APPS } from '../../../src/config/apps';

describe('resolveEnabledModules', () => {
  it('returns all APPS when unset', () => {
    expect(resolveEnabledModules(undefined)).toEqual([...APPS]);
  });
  it("returns all APPS for the literal 'all'", () => {
    expect(resolveEnabledModules('all')).toEqual([...APPS]);
  });
  it('parses a comma list (trimming + dropping blanks)', () => {
    expect(resolveEnabledModules(' google , meta ,')).toEqual(['google', 'meta']);
  });
  it('throws on an unknown slug, naming it', () => {
    expect(() => resolveEnabledModules('google,nope')).toThrow(/nope/);
  });
});
