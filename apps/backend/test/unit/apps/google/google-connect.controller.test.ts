import { describe, expect, it, vi } from 'vitest';
import type { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';
import { GoogleConnectController } from '../../../../src/modules/google/google-oauth/google-oauth.controller';

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
  it('exchanges the code and returns a popup-close page that postMessages the opener', async () => {
    const auth = { handleCallback: vi.fn(async () => {}) } as unknown as GoogleAuthService;
    const config = { get: () => 'https://admin.example.com/google' } as never;
    let body = '';
    const headers: Record<string, string> = {};
    const reply = {
      header: vi.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      send: vi.fn(async (html: string) => {
        body = html;
      }),
    } as never;

    const controller = new GoogleConnectController(auth, config);
    await controller.callback('the-code', 'merchant-1', reply);

    expect(auth.handleCallback).toHaveBeenCalledWith('the-code', 'merchant-1');
    expect(headers['content-type']).toContain('text/html');
    // Posts the connected signal to the opener, scoped to the admin ORIGIN.
    expect(body).toContain('postMessage');
    expect(body).toContain("source: 'ratio-google-oauth', connected: true");
    expect(body).toContain('"https://admin.example.com"'); // targetOrigin (origin only)
    // Falls back to a redirect when there's no opener (popup blocked).
    expect(body).toContain('"https://admin.example.com/google/config?connected=1"');
  });
});
