import { describe, expect, it } from 'vitest';
import { MODULE_REGISTRY } from '../../src/module-registry';
import { APPS } from '../../src/config/apps';

describe('MODULE_REGISTRY', () => {
  it('has an entry for every slug in APPS', () => {
    for (const slug of APPS) expect(MODULE_REGISTRY.has(slug)).toBe(true);
  });
  it('has no entries beyond APPS', () => {
    for (const key of MODULE_REGISTRY.keys()) {
      expect((APPS as readonly string[]).includes(key)).toBe(true);
    }
  });
});
