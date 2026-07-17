import { describe, expect, it, vi } from 'vitest';
import { DelhiveryClient, DelhiveryClientError } from './client';

const RESULT = {
  serviceable: true,
  cod_available: true,
  edd_min: 2,
  edd_max: 5,
  carrier: 'DELHIVERY',
};

function mockFetch(json: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

const cfg = { apiBase: 'https://apps.ratio.example', merchantId: 'mer_1' };

describe('DelhiveryClient', () => {
  it('client.buildsUrl — GETs the public serviceability endpoint with merchantId + pincode', async () => {
    const fetchImpl = mockFetch(RESULT);
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.checkServiceability('110001');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://apps.ratio.example/delhivery/api/serviceability?merchantId=mer_1&pincode=110001',
    );
    expect(init.method).toBe('GET');
  });

  it('client.forwardsOrderValueCod — appends order_value and cod when provided', async () => {
    const fetchImpl = mockFetch(RESULT);
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.checkServiceability('110001', { orderValue: 1499.5, cod: true });
    const url = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain('order_value=1499.5');
    expect(url).toContain('cod=true');

    await c.checkServiceability('110001', { cod: false });
    const url2 = (fetchImpl.mock.calls[1] as unknown as [string])[0];
    expect(url2).toContain('cod=false');
    expect(url2).not.toContain('order_value=');
  });

  it('client.trimsApiBase — a trailing slash on apiBase does not double up', async () => {
    const fetchImpl = mockFetch(RESULT);
    const c = new DelhiveryClient(
      { ...cfg, apiBase: 'https://apps.ratio.example/' },
      fetchImpl as unknown as typeof fetch,
    );
    await c.checkServiceability('110001');
    const url = (fetchImpl.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain('https://apps.ratio.example/delhivery/api/serviceability?');
  });

  it('client.rejectsBadPincode — non-6-digit PINs never reach the network', async () => {
    const fetchImpl = mockFetch(RESULT);
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    for (const bad of ['1100', '11000a', '011001', '1100011', '']) {
      await expect(c.checkServiceability(bad)).rejects.toMatchObject({
        name: 'DelhiveryClientError',
        status: 400,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('client.trimsPincode — surrounding whitespace is tolerated', async () => {
    const fetchImpl = mockFetch(RESULT);
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    await c.checkServiceability(' 110001 ');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('pincode=110001');
  });

  it('client.mapsResponse — returns the serviceability verdict as-is', async () => {
    const fetchImpl = mockFetch(RESULT);
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    const r = await c.checkServiceability('110001');
    expect(r).toEqual(RESULT);
  });

  it('client.unwrapsEnvelope — tolerates the backend `{ data }` response envelope', async () => {
    const fetchImpl = mockFetch({ status_code: 200, message: 'ok', data: RESULT });
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    const r = await c.checkServiceability('110001');
    expect(r.serviceable).toBe(true);
    expect(r.edd_max).toBe(5);
  });

  it('client.throwsOnHttpError — non-2xx raises DelhiveryClientError with the status', async () => {
    const fetchImpl = vi.fn(async () => new Response('merchant not installed', { status: 404 }));
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    const err = await c.checkServiceability('110001').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DelhiveryClientError);
    expect((err as DelhiveryClientError).status).toBe(404);
  });

  it('client.abortsInflight — a new check aborts the previous in-flight one', async () => {
    const fetchImpl = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) =>
          (init.signal as AbortSignal).addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const c = new DelhiveryClient(cfg, fetchImpl as unknown as typeof fetch);
    const p1 = c.checkServiceability('110001').catch((e: unknown) => e);
    c.checkServiceability('560001').catch(() => {});
    const err = (await p1) as Error;
    expect(err.name).toBe('AbortError');
  });
});
