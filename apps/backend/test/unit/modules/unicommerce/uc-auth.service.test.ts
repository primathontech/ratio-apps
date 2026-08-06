import { describe, expect, it, vi } from 'vitest';
import { UcAuthService } from '../../../../src/modules/unicommerce/services/uc-auth.service';

describe('UcAuthService.authenticate', () => {
  it('issues a 48h token on valid credentials', async () => {
    const credentials = {
      verify: vi.fn().mockResolvedValue('merchant-123'),
    };
    const db = {
      db: {
        insertInto: () => ({ values: () => ({ execute: async () => undefined }) }),
      },
    };
    const svc = new UcAuthService(credentials as never, db as never);

    const result = await svc.authenticate('ratio-abc123', 'correct-password');

    expect(result.status).toBe('SUCCESS');
    if (result.status === 'SUCCESS') {
      expect(typeof result.accessToken).toBe('string');
      expect(result.accessToken.length).toBeGreaterThan(20);
    }
  });

  it('returns INVALID_CREDENTIALS when verify fails', async () => {
    const credentials = { verify: vi.fn().mockResolvedValue(null) };
    const db = { db: {} };
    const svc = new UcAuthService(credentials as never, db as never);

    const result = await svc.authenticate('ratio-abc123', 'wrong-password');

    expect(result.status).toBe('INVALID_CREDENTIALS');
  });
});
