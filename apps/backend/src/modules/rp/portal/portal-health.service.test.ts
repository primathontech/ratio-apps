import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpPortalHealthService } from './portal-health.service';

/**
 * RP's hosted portal (`{RP_BASE_URL}/os/v1/customer-portal`) has been observed broken in prod
 * in two distinct ways that a blind redirect can't detect: (1) the shell itself unreachable
 * (a live 503 from an AWS ELB with no healthy backend), and (2) the shell returns 200 but the
 * JS/CSS it references — hosted on a separate CDN origin — 403s, so RP's own frontend never
 * boots. This service probes for both, server-side (no CORS restriction applies to our own
 * outbound fetch), and fails OPEN on any inconclusive signal so a flaky probe never blocks a
 * customer from a portal that might genuinely be fine.
 */
function htmlWithAsset(assetUrl: string): string {
  return `<html><head><script type="module" src="${assetUrl}"></script></head><body></body></html>`;
}

function htmlNoExternalAssets(): string {
  return '<html><head><script src="/local/bundle.js"></script></head><body></body></html>';
}

function makeResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('RpPortalHealthService.checkHealthy', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is healthy on a 2xx shell with no external asset references', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, htmlNoExternalAssets()));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/os/v1/customer-portal')).resolves.toBe(true);
    // Only the shell itself should be fetched — no external asset to probe.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is healthy on a 2xx shell whose external asset is also reachable', async () => {
    const html = htmlWithAsset('https://rp-web-assets.returnprime.co/proxyV2/prod/v1/assets/app.js');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(200, html))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/os/v1/customer-portal')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://rp-web-assets.returnprime.co/proxyV2/prod/v1/assets/app.js',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('is unhealthy when the shell itself returns a non-2xx status (e.g. a 503 from an unhealthy ELB)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/os/v1/customer-portal')).resolves.toBe(false);
  });

  it('is healthy on a 404 shell that still returns the real app body with a reachable external asset (SPA host tags deep links 404 but serves the working bundle anyway)', async () => {
    const html = htmlWithAsset('https://rp-web-assets.returnprime.co/proxyV2/prod/v1/assets/app.js');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(404, html))
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/sandbox-momsco.dev.gokwik.io')).resolves.toBe(true);
  });

  it('is unhealthy on a 404 shell whose asset also fails (the 404-tagged body was not actually a working app)', async () => {
    const html = htmlWithAsset('https://rp-web-assets.returnprime.co/proxyV2/prod/v1/assets/app.js');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(404, html))
      .mockResolvedValueOnce(makeResponse(403));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/sandbox-momsco.dev.gokwik.io')).resolves.toBe(false);
  });

  it('is unhealthy on a 404 shell with no discoverable app content at all (a genuine not-found page)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(404, '<html><body>Not Found</body></html>'));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/sandbox-momsco.dev.gokwik.io')).resolves.toBe(false);
  });

  it('is unhealthy when the shell is 2xx but its external asset 403s (the real production bug)', async () => {
    const html = htmlWithAsset('https://rp-web-assets.returnprime.co/proxyV2/prod/v1/assets/app.js');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(200, html))
      .mockResolvedValueOnce(makeResponse(403));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/os/v1/customer-portal')).resolves.toBe(false);
  });

  it('fails open (healthy) when the shell fetch throws a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/os/v1/customer-portal')).resolves.toBe(true);
  });

  it('fails open (healthy) when the shell fetch is aborted by the timeout', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    const resultPromise = service.checkHealthy('https://rp.example/os/v1/customer-portal');
    await vi.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe(true);
  });

  it('fails open (healthy) when the asset probe itself throws/times out', async () => {
    const html = htmlWithAsset('https://rp-web-assets.returnprime.co/proxyV2/prod/v1/assets/app.js');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(200, html))
      .mockRejectedValueOnce(new Error('asset probe network error'));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await expect(service.checkHealthy('https://rp.example/os/v1/customer-portal')).resolves.toBe(true);
  });

  it('caches the result and does not re-fetch within the TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, htmlNoExternalAssets()));
    vi.stubGlobal('fetch', fetchMock);
    const service = new RpPortalHealthService();

    await service.checkHealthy('https://rp.example/os/v1/customer-portal');
    await service.checkHealthy('https://rp.example/os/v1/customer-portal');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
