import { describe, expect, it, vi } from 'vitest';
import { GoogleConnectController } from '../../../../src/modules/google/google-oauth/google-oauth.controller';
import type { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';

describe('GoogleConnectController.connect', () => {
  it('returns the Google consent URL as JSON for the current merchant (no redirect)', () => {
    const consentUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=merchant-1';
    const auth = { buildAuthUrl: vi.fn(() => consentUrl) } as unknown as GoogleAuthService;
    const config = { get: () => 'http://localhost:5173' } as never;

    const controller = new GoogleConnectController(auth, config);
    const result = controller.connect({ id: 'merchant-1' } as never);

    expect(auth.buildAuthUrl).toHaveBeenCalledWith('merchant-1');
    expect(result).toEqual({ url: consentUrl });
  });
});

describe('GoogleConnectController.callback', () => {
  it('exchanges the code and redirects to the admin config page with ?connected=1', async () => {
    const auth = { handleCallback: vi.fn(async () => {}) } as unknown as GoogleAuthService;
    const config = { get: () => 'http://localhost:5173' } as never;
    const redirects: string[] = [];
    const reply = {
      redirect: vi.fn(async (url: string) => {
        redirects.push(url);
      }),
    } as never;

    const controller = new GoogleConnectController(auth, config);
    await controller.callback('the-code', 'merchant-1', reply);

    expect(auth.handleCallback).toHaveBeenCalledWith('the-code', 'merchant-1');
    expect(redirects[0]).toBe('http://localhost:5173/config?connected=1');
  });
});
