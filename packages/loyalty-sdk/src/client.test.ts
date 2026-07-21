import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoyaltyClient, LoyaltyClientError } from './client';

const cfg = { apiBase: 'https://apps.example.com', merchantId: 'm1' };

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

  it('publicConfig GETs /loyalty/sdk/config/{merchantId}', async () => {
    const fetchImpl = mockFetch({ programName: 'Coins', enabled: true, version: '0.1.0' });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const res = await c.publicConfig();
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://apps.example.com/loyalty/sdk/config/m1');
    expect(res.programName).toBe('Coins');
  });

  it('qrStatus GETs /loyalty/qr/{code}/status', async () => {
    const fetchImpl = mockFetch({
      state: 'active',
      eventName: 'Launch Party',
      points: 50,
      programName: 'Coins',
    });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const res = await c.qrStatus('ABCD1234');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://apps.example.com/loyalty/qr/ABCD1234/status');
    expect(init.method).toBeUndefined();
    expect(res.state).toBe('active');
  });

  it('claim POSTs JSON with ONLY the gkAccessToken (never a phone)', async () => {
    const fetchImpl = mockFetch({
      status: 'credited',
      points: 50,
      newBalance: 150,
      programName: 'Coins',
    });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    const res = await c.claim('ABCD1234', 'gk-token');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://apps.example.com/loyalty/qr/ABCD1234/claim');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ gkAccessToken: 'gk-token' });
    expect(res.status).toBe('credited');
  });

  it('URL-encodes the code segment', async () => {
    const fetchImpl = mockFetch({ state: 'active', eventName: '', points: 0, programName: '' });
    const c = new LoyaltyClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.qrStatus('a/b?c');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://apps.example.com/loyalty/qr/a%2Fb%3Fc/status',
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
