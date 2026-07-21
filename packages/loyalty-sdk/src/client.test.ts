import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoyaltyClient, LoyaltyClientError } from './client';

const cfg = { baseUrl: 'https://shop.example.com' };

function mockFetch(json: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('LoyaltyClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('qrStatus GETs /api/loyalty/status?qr={code} on the same-origin baseUrl', async () => {
    const fetchImpl = mockFetch({
      state: 'active',
      eventName: 'Launch Party',
      points: 50,
      programName: 'Coins',
    });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const res = await c.qrStatus('ABCD1234');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://shop.example.com/api/loyalty/status?qr=ABCD1234');
    expect(init.method).toBeUndefined();
    expect(res.state).toBe('active');
  });

  it('sends no ngrok-skip-browser-warning header (same-origin, no tunnel)', async () => {
    const fetchImpl = mockFetch({ state: 'active', eventName: '', points: 0, programName: '' });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.qrStatus('ABCD1234');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['ngrok-skip-browser-warning']).toBeUndefined();
  });

  it('returns the BFF body as-is (no envelope unwrap)', async () => {
    // The storefront BFF returns clean JSON — never the backend's
    // { status_code, message, data } envelope.
    const fetchImpl = mockFetch({
      state: 'active',
      eventName: 'Diwali EXPO',
      points: 50,
      programName: 'Coins',
    });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const res = await c.qrStatus('ABCD1234');
    expect(res.eventName).toBe('Diwali EXPO');
    expect(res.state).toBe('active');
  });

  it('claim POSTs JSON with { qr, gkAccessToken } (never a phone)', async () => {
    const fetchImpl = mockFetch({
      status: 'credited',
      points: 50,
      newBalance: 150,
      programName: 'Coins',
    });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const res = await c.claim('ABCD1234', 'gk-token');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://shop.example.com/api/loyalty/claim');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ qr: 'ABCD1234', gkAccessToken: 'gk-token' });
    expect(res.status).toBe('credited');
  });

  it('URL-encodes the qr code query param', async () => {
    const fetchImpl = mockFetch({ state: 'active', eventName: '', points: 0, programName: '' });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.qrStatus('a/b?c');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://shop.example.com/api/loyalty/status?qr=a%2Fb%3Fc',
    );
  });

  it('throws a typed LoyaltyClientError on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const err = await c.qrStatus('NOPE').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoyaltyClientError);
    expect((err as LoyaltyClientError).status).toBe(404);
  });

  it('aborts the request after the 5s timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          (init.signal as AbortSignal).addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const pending = c.qrStatus('SLOW').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    const err = (await pending) as Error;
    expect(err.name).toBe('AbortError');
  });
});
