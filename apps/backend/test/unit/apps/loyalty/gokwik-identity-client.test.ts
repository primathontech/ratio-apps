import { describe, expect, it, vi } from 'vitest';
import { GokwikIdentityClient } from '../../../../src/modules/loyalty/core-client/gokwik-identity.client';

function makeClient(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  });
  const client = new GokwikIdentityClient({
    baseUrl: 'https://gk.test',
    fetchImpl: impl as unknown as typeof fetch,
  });
  return { client, calls };
}

describe('GokwikIdentityClient', () => {
  it('resolves the verified customer with normalized phone and sends the gk headers', async () => {
    const { client, calls } = makeClient(200, {
      data: { phone: '9876543210', name: 'Priya', email: 'priya@example.com' },
    });
    const verified = await client.verify('gk-token-1', 'm1');
    expect(verified).toEqual({ phone: '+919876543210', name: 'Priya', email: 'priya@example.com' });
    expect(calls[0]!.url).toBe('https://gk.test/v1/storefront/customers/profile');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['gk-access-token']).toBe('gk-token-1');
    expect(headers['gk-merchant-id']).toBe('m1');
  });

  it('accepts flat (non-enveloped) profile payloads', async () => {
    const { client } = makeClient(200, { phone_number: '+919876543210' });
    expect(await client.verify('t', 'm1')).toMatchObject({ phone: '+919876543210' });
  });

  it('returns null on 401/403/500 — no oracle about why', async () => {
    for (const status of [401, 403, 500]) {
      const { client } = makeClient(status, {});
      expect(await client.verify('bad', 'm1')).toBeNull();
    }
  });

  it('returns null when the profile has no usable phone', async () => {
    const { client } = makeClient(200, { data: { name: 'No Phone' } });
    expect(await client.verify('t', 'm1')).toBeNull();
  });

  it('never logs the access token', async () => {
    const { client } = makeClient(500, {});
    const logged: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: reach into the private logger for the spy
    const logger = (client as any).logger;
    for (const level of ['error', 'warn', 'log']) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      });
    }
    await client.verify('gk-SECRET-token', 'm1');
    expect(logged.join(' ')).not.toContain('gk-SECRET-token');
  });
});
