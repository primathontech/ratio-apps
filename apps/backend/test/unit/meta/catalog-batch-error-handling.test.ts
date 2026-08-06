import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogBatchService, type CatalogBatchRequest } from '../../../src/modules/meta/catalog/catalog-batch.service';

/**
 * A real Meta OAuthException code 190 (expired/invalid token) or code 80014
 * (catalog batch rate limit) fails EVERY item in the batch, not one — the
 * previous behaviour (bisect on any non-429 4xx) treated these the same as a
 * single bad item and recursively halved the batch down to singles, wasting
 * calls and, for the rate-limit case, making the throttling worse.
 */
function metaError(code: number, message: string, type = 'OAuthException') {
  return JSON.stringify({ error: { message, type, code, fbtrace_id: 'trace123' } });
}

function requests(n: number): CatalogBatchRequest[] {
  return Array.from({ length: n }, (_, i) => ({ method: 'CREATE' as const, retailer_id: `r${i}` }));
}

function fakeFetch(handler: (call: { url: string; body: string }) => Response) {
  const calls: { url: string; body: string }[] = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), body: String(init?.body ?? '') };
    calls.push(call);
    return Promise.resolve(handler(call));
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

/** How many retailer_ids were included in a given fetch call's form-encoded body. */
function itemCountInCall(body: string): number {
  const requestsJson = new URLSearchParams(body).get('requests');
  return requestsJson ? (JSON.parse(requestsJson) as unknown[]).length : 0;
}

describe('CatalogBatchService — systemic error classification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('expired token (OAuthException 190): fails the whole batch in ONE call, does not bisect', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(metaError(190, 'Session has expired on Wednesday...'), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetch);

    const svc = new CatalogBatchService();
    const resultPromise = svc.send('cat1', 'expired-token', requests(10));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Bisecting 10 items down to singles would produce ~19 calls; a fail-fast
    // whole-batch auth failure should make exactly one.
    expect(calls).toHaveLength(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(10);
    expect(result.failures).toHaveLength(10);
    expect(result.failures[0]?.error).toContain('Session has expired');
  });

  it('expired token stops further chunks too — send() does not keep calling Meta once the token is known bad', async () => {
    vi.stubEnv('META_CATALOG_BATCH_SIZE', '5');
    vi.resetModules();
    const { CatalogBatchService: FreshService } = await import(
      '../../../src/modules/meta/catalog/catalog-batch.service'
    );

    const { fetch, calls } = fakeFetch(
      () => new Response(metaError(190, 'Session has expired'), { status: 401 }),
    );
    vi.stubGlobal('fetch', fetch);

    const svc = new FreshService();
    // 12 requests / batch size 5 → 3 chunks if it kept going. Only the first
    // chunk should ever be sent once the auth failure is detected.
    const resultPromise = svc.send('cat1', 'expired-token', requests(12));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(calls).toHaveLength(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(12); // all 12 recorded as failed, including the 7 never attempted
  });

  it('catalog rate limit (#80014, non-429 status): retries the WHOLE chunk, does not bisect', async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(
          metaError(80014, '(#80014) There have been too many calls for the batch uploads to this catalog account.'),
          { status: 400 },
        ),
    );
    vi.stubGlobal('fetch', fetch);

    const svc = new CatalogBatchService();
    const resultPromise = svc.send('cat1', 'token', requests(10));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // MAX_ATTEMPTS = 3 whole-chunk retries, not a bisection tree.
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(itemCountInCall(call.body)).toBe(10);
    }
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(10);
  });

  it('catalog rate limit clears on retry: whole chunk (not halves) succeeds once Meta stops throttling', async () => {
    let attempt = 0;
    const { fetch, calls } = fakeFetch(() => {
      attempt += 1;
      if (attempt < 3) {
        return new Response(metaError(80014, '(#80014) too many calls'), { status: 400 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);

    const svc = new CatalogBatchService();
    const resultPromise = svc.send('cat1', 'token', requests(10));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(itemCountInCall(call.body)).toBe(10);
    }
    expect(result.sent).toBe(10);
    expect(result.failed).toBe(0);
  });

  it('regression: a genuine per-item content rejection still bisects to isolate the one bad item', async () => {
    const BAD_ID = 'r1';
    const { fetch } = fakeFetch((call) => {
      const requestsJson = new URLSearchParams(call.body).get('requests');
      const items = JSON.parse(requestsJson ?? '[]') as { data: { id: string } }[];
      const hasBad = items.some((r) => r.data.id === BAD_ID);
      if (hasBad) {
        return new Response(JSON.stringify({ error: { message: 'invalid image_link', type: 'GraphMethodException', code: 100 } }), { status: 400 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);

    const svc = new CatalogBatchService();
    const resultPromise = svc.send('cat1', 'token', requests(3));
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([{ retailerId: BAD_ID, error: expect.stringContaining('invalid image_link') }]);
  });
});
