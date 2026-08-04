import { describe, expect, it, vi } from 'vitest';
import { UcOAuthController } from '../../../../src/modules/unicommerce/oauth/oauth.controller';

function fakeConfig(adminBaseUrl: string) {
  return { get: () => adminBaseUrl } as never;
}

function fakeReply() {
  return {
    setCookie: vi.fn(),
    redirect: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  };
}

describe('UcOAuthController.callback', () => {
  it('exchanges the code, sets the install cookie, and redirects to the admin SPA root', async () => {
    const oauth = { handleCallback: vi.fn().mockResolvedValue({ merchantId: 'm1' }) };
    const controller = new UcOAuthController(oauth as never, fakeConfig('http://localhost:5175'));
    const reply = fakeReply();

    await controller.callback({ code: 'auth-code-1' }, reply as never);

    expect(oauth.handleCallback).toHaveBeenCalledWith('auth-code-1');
    expect(reply.setCookie).toHaveBeenCalledWith(
      'ratio_install_merchant_unicommerce',
      'm1',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'none' }),
    );
    expect(reply.redirect).toHaveBeenCalledWith('http://localhost:5175/', 302);
  });
});

describe('UcOAuthController.installSession', () => {
  it('returns the merchantId from the install cookie when present', () => {
    const controller = new UcOAuthController({} as never, fakeConfig('http://localhost:5175'));
    const req = { cookies: { ratio_install_merchant_unicommerce: 'm1' } };

    expect(controller.installSession(req as never)).toEqual({ merchantId: 'm1' });
  });

  it('returns null when the cookie is absent (no throw)', () => {
    const controller = new UcOAuthController({} as never, fakeConfig('http://localhost:5175'));
    expect(controller.installSession({ cookies: {} } as never)).toEqual({ merchantId: null });
    expect(controller.installSession({} as never)).toEqual({ merchantId: null });
  });
});

describe('UcOAuthController.clearInstallSession', () => {
  it('clears the cookie with maxAge 0 and responds 204', () => {
    const controller = new UcOAuthController({} as never, fakeConfig('http://localhost:5175'));
    const reply = fakeReply();

    controller.clearInstallSession(reply as never);

    expect(reply.setCookie).toHaveBeenCalledWith(
      'ratio_install_merchant_unicommerce',
      '',
      expect.objectContaining({ maxAge: 0 }),
    );
    expect(reply.status).toHaveBeenCalledWith(204);
    expect(reply.send).toHaveBeenCalled();
  });
});
