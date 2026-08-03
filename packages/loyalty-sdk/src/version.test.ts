import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from './version';

describe('version', () => {
  it('is a semver string', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
