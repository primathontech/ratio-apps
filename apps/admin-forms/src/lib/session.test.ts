import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPostMessageListener } from './session';

const STORAGE_KEY = 'forms-ratio:merchant-id';

function postSession(origin: string, merchantId = 'attacker-merchant'): void {
  window.dispatchEvent(
    new MessageEvent('message', { origin, data: { type: 'ratio:session', merchantId } }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('installPostMessageListener', () => {
  it('fails closed: rejects every origin when the dashboard origin is unset', () => {
    vi.stubEnv('VITE_RATIO_DASHBOARD_ORIGIN', '');
    const onSession = vi.fn();
    const cleanup = installPostMessageListener(onSession);

    postSession('https://evil.example');

    expect(onSession).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    cleanup();
  });

  it('rejects messages from an origin other than the configured dashboard', () => {
    vi.stubEnv('VITE_RATIO_DASHBOARD_ORIGIN', 'https://dash.example');
    const onSession = vi.fn();
    const cleanup = installPostMessageListener(onSession);

    postSession('https://evil.example');

    expect(onSession).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    cleanup();
  });

  it('accepts a ratio:session message from the configured dashboard origin', () => {
    vi.stubEnv('VITE_RATIO_DASHBOARD_ORIGIN', 'https://dash.example');
    const onSession = vi.fn();
    const cleanup = installPostMessageListener(onSession);

    postSession('https://dash.example', 'merchant-42');

    expect(onSession).toHaveBeenCalledWith('merchant-42');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('merchant-42');
    cleanup();
  });
});
