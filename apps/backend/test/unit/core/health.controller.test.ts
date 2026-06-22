import { describe, expect, it } from 'vitest';
import { HealthController } from '../../../src/core/health/health.controller';

describe('HealthController.live', () => {
  it('returns a static live payload (no registry needed)', () => {
    // live() ignores the registry, so a stub is fine.
    const c = new HealthController({ isBooted: () => false, list: () => [] } as never);
    expect(c.live()).toEqual({ status: 'live' });
  });
});
