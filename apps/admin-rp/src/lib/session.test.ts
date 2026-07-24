import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPostMessageListener } from './session';

// The bug this guards against: installPostMessageListener used to trust
// VITE_RATIO_DASHBOARD_ORIGIN, which ships blank in .env.example ("leave
// empty in dev to accept any origin"). A prod deploy that forgot to set it
// would silently accept a `ratio:session` postMessage — and the merchant id
// inside it — from ANY origin. It now reuses useIframeAuth's real allow-list
// (gokwik.co/gokwik.in + localhost) instead, so there's no unset-env-var path
// to a wide-open listener.
describe('installPostMessageListener', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function dispatch(origin: string, data: unknown) {
    window.dispatchEvent(new MessageEvent('message', { origin, data }));
  }

  it('accepts a session message from a real gokwik.co origin', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('https://store.gokwik.co', { type: 'ratio:session', merchantId: 'm1' });
    expect(onSession).toHaveBeenCalledWith('m1');
    expect(window.localStorage.getItem('rp-ratio:merchant-id')).toBe('m1');
    stop();
  });

  it('accepts a session message from a gokwik.in origin', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('https://dashboard.gokwik.in', { type: 'ratio:session', merchantId: 'm2' });
    expect(onSession).toHaveBeenCalledWith('m2');
    stop();
  });

  it('accepts a session message from localhost (local dev)', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('http://localhost:5173', { type: 'ratio:session', merchantId: 'm3' });
    expect(onSession).toHaveBeenCalledWith('m3');
    stop();
  });

  it('rejects a session message from an attacker-controlled origin', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('https://evil.example.com', { type: 'ratio:session', merchantId: 'attacker' });
    expect(onSession).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('rp-ratio:merchant-id')).toBeNull();
    stop();
  });

  it('rejects a look-alike origin (suffix match without a dot boundary)', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('https://evilgokwik.co', { type: 'ratio:session', merchantId: 'attacker' });
    expect(onSession).not.toHaveBeenCalled();
    stop();
  });

  it('rejects a plain-http gokwik.co origin (not https)', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('http://store.gokwik.co', { type: 'ratio:session', merchantId: 'm4' });
    expect(onSession).not.toHaveBeenCalled();
    stop();
  });

  it('ignores a differently-typed message even from an allowed origin', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    dispatch('https://store.gokwik.co', { type: 'something:else', merchantId: 'm5' });
    expect(onSession).not.toHaveBeenCalled();
    stop();
  });

  it('stops listening once the returned cleanup is called', () => {
    const onSession = vi.fn();
    const stop = installPostMessageListener(onSession);
    stop();
    dispatch('https://store.gokwik.co', { type: 'ratio:session', merchantId: 'm6' });
    expect(onSession).not.toHaveBeenCalled();
  });
});
