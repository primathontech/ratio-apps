import { describe, expect, it, vi } from 'vitest';
import { UcAuthController } from '../../../../src/modules/unicommerce/controllers/auth.controller';

// Handlers now also take @Req() (for inbound debug logging) — a minimal
// stand-in is enough since logInboundRequest only reads method/url/headers/body.
const fakeReq = { method: 'GET', url: '/unicommerce/api/v1/authToken', headers: {}, body: undefined } as never;

describe('UcAuthController', () => {
  it('returns status and accessToken on a successful auth', async () => {
    const auth = {
      authenticate: vi.fn().mockResolvedValue({ status: 'SUCCESS', accessToken: 'tok-1', merchantId: 'm1' }),
    };
    const controller = new UcAuthController(auth as never, { record: vi.fn() } as never);

    const result = await controller.getAuthToken({ username: 'u', password: 'p' }, fakeReq);

    expect(result).toEqual({ status: 'SUCCESS', accessToken: 'tok-1' });
  });

  it('returns INVALID_CREDENTIALS without writing an event-log row', async () => {
    const auth = { authenticate: vi.fn().mockResolvedValue({ status: 'INVALID_CREDENTIALS' }) };
    const eventLog = { record: vi.fn() };
    const controller = new UcAuthController(auth as never, eventLog as never);

    const result = await controller.postAuthToken({ username: 'u', password: 'wrong' }, fakeReq);

    expect(result).toEqual({ status: 'INVALID_CREDENTIALS' });
    expect(eventLog.record).not.toHaveBeenCalled();
  });

  // Fix 2: an event-log write failure must never turn a real auth success
  // into a rejected request handler (a 500 to Unicommerce for an operation
  // that actually succeeded).
  it('still returns the correct success response when eventLog.record() rejects (Fix 2)', async () => {
    const auth = {
      authenticate: vi.fn().mockResolvedValue({ status: 'SUCCESS', accessToken: 'tok-1', merchantId: 'm1' }),
    };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcAuthController(auth as never, eventLog as never);

    const result = await controller.getAuthToken({ username: 'u', password: 'p' }, fakeReq);

    expect(result).toEqual({ status: 'SUCCESS', accessToken: 'tok-1' });
  });
});
