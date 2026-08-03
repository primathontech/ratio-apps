import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getKwikPassToken, KWIKPASS_TOKEN_KEYS, onLoggedIn, requestLogin } from './kwikpass';

function clearAll(): void {
  window.localStorage.clear();
  for (const key of KWIKPASS_TOKEN_KEYS) {
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

describe('kwikpass bridge', () => {
  beforeEach(clearAll);
  afterEach(() => {
    clearAll();
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup of the host-provided global
    window.handleCustomLogin = undefined;
  });

  describe('getKwikPassToken', () => {
    it('returns null when no key is set anywhere', () => {
      expect(getKwikPassToken()).toBeNull();
    });

    it('reads the cookie first', () => {
      document.cookie = 'KWIKUSERTOKEN=cookie-token; path=/';
      window.localStorage.setItem('KWIKUSERTOKEN', 'ls-token');
      expect(getKwikPassToken()).toBe('cookie-token');
    });

    it('falls back to localStorage when the cookie is absent', () => {
      window.localStorage.setItem('KWIKUSERTOKEN', 'ls-token');
      expect(getKwikPassToken()).toBe('ls-token');
    });

    it('checks the environment keys in priority order', () => {
      window.localStorage.setItem('DEVKWIKUSERTOKEN', 'dev-token');
      window.localStorage.setItem('SANDBOXKWIKUSERTOKEN', 'sandbox-token');
      expect(getKwikPassToken()).toBe('sandbox-token');
    });

    it('finds a token under any environment key', () => {
      document.cookie = 'QAKWIKUSERTOKEN=qa-token; path=/';
      expect(getKwikPassToken()).toBe('qa-token');
    });

    it('URL-decodes cookie values', () => {
      document.cookie = `KWIKUSERTOKEN=${encodeURIComponent('a=b&c')}; path=/`;
      expect(getKwikPassToken()).toBe('a=b&c');
    });
  });

  describe('requestLogin', () => {
    it('dispatches loyalty:login:request AND calls window.handleCustomLogin(false)', () => {
      const onRequest = vi.fn();
      window.addEventListener('loyalty:login:request', onRequest);
      const handleCustomLogin = vi.fn();
      window.handleCustomLogin = handleCustomLogin;

      requestLogin();

      expect(onRequest).toHaveBeenCalledTimes(1);
      expect(handleCustomLogin).toHaveBeenCalledWith(false);
      window.removeEventListener('loyalty:login:request', onRequest);
    });

    it('still dispatches the event when handleCustomLogin is missing or throws', () => {
      const onRequest = vi.fn();
      window.addEventListener('loyalty:login:request', onRequest);

      expect(() => requestLogin()).not.toThrow();
      window.handleCustomLogin = () => {
        throw new Error('host broke');
      };
      expect(() => requestLogin()).not.toThrow();

      expect(onRequest).toHaveBeenCalledTimes(2);
      window.removeEventListener('loyalty:login:request', onRequest);
    });
  });

  describe('onLoggedIn', () => {
    it('fires on the user-loggedin window event', () => {
      const cb = vi.fn();
      const unsub = onLoggedIn(cb);
      window.dispatchEvent(new CustomEvent('user-loggedin'));
      expect(cb).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('unsubscribes', () => {
      const cb = vi.fn();
      const unsub = onLoggedIn(cb);
      unsub();
      window.dispatchEvent(new CustomEvent('user-loggedin'));
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
