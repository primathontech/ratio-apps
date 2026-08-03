import { describe, expect, it, vi } from 'vitest';
import {
  CoreLoyaltyClient,
  CoreLoyaltyError,
} from '../../../../src/modules/loyalty/core-client/core-loyalty.client';

const POINTS_OK = JSON.stringify({
  phone: '+919876543210',
  new_balance: 150,
  transaction_id: 't1',
});

/** fetch fake driven by a queue of scripted responses. */
function scriptedFetch(script: { status: number; body?: string }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = script.shift() ?? { status: 200, body: POINTS_OK };
    return new Response(next.body ?? POINTS_OK, { status: next.status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function makeClient(script: { status: number; body?: string }[], tokens?: string[]) {
  const tokenQueue = tokens ?? ['tok-1'];
  const provider = {
    getAccessToken: vi.fn(async (_m: string, opts?: { forceRefresh?: boolean }) => {
      if (opts?.forceRefresh) return tokenQueue[1] ?? 'tok-refreshed';
      return tokenQueue[0] ?? 'tok-1';
    }),
  };
  const { impl, calls } = scriptedFetch(script);
  const client = new CoreLoyaltyClient(provider, { baseUrl: 'https://core.test', fetchImpl: impl });
  return { client, calls, provider };
}

const CREDIT = {
  merchantId: 'm1',
  phone: '+919876543210',
  points: 100,
  idempotencyKey: 'bulk:op1:1',
  description: 'Diwali bonus',
  metadata: { source: 'bulk_upload' },
};

describe('CoreLoyaltyClient', () => {
  it('sends the exact Core credit contract with bearer token and idempotency key', async () => {
    const { client, calls } = makeClient([{ status: 201, body: POINTS_OK }]);
    const res = await client.credit(CREDIT);
    expect(res.new_balance).toBe(150);
    expect(calls[0]!.url).toBe('https://core.test/api/v1/loyalty/points/credit');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({
      phone: '+919876543210',
      points: 100,
      idempotency_key: 'bulk:op1:1',
      description: 'Diwali bonus',
      metadata: { source: 'bulk_upload' },
    });
  });

  it('retries 429 and 5xx with backoff then succeeds', async () => {
    const { client, calls } = makeClient([
      { status: 429, body: '{}' },
      { status: 500, body: '{}' },
      { status: 201, body: POINTS_OK },
    ]);
    const res = await client.credit(CREDIT);
    expect(res.transaction_id).toBe('t1');
    expect(calls.length).toBe(3);
  });

  it('fails with a typed error after exhausting retries', async () => {
    const { client } = makeClient([
      { status: 503, body: '{}' },
      { status: 503, body: '{}' },
      { status: 503, body: '{}' },
    ]);
    await expect(client.credit(CREDIT)).rejects.toMatchObject({
      name: 'CoreLoyaltyError',
      kind: 'upstream_error',
    });
  });

  it('refreshes the token once on 401 then retries; a second 401 is terminal', async () => {
    const { client, calls, provider } = makeClient(
      [
        { status: 401, body: '{}' },
        { status: 201, body: POINTS_OK },
      ],
      ['tok-old', 'tok-new'],
    );
    await client.credit(CREDIT);
    expect(provider.getAccessToken).toHaveBeenCalledWith('m1', { forceRefresh: true });
    const secondHeaders = calls[1]!.init.headers as Record<string, string>;
    expect(secondHeaders.authorization).toBe('Bearer tok-new');

    const twice = makeClient([
      { status: 401, body: '{}' },
      { status: 401, body: '{}' },
    ]);
    await expect(twice.client.credit(CREDIT)).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(twice.calls.length).toBe(2); // no refresh loop
  });

  it('maps 4xx to typed errors without retrying', async () => {
    const bad = makeClient([{ status: 400, body: '{"message":"insufficient balance"}' }]);
    await expect(bad.client.debit(CREDIT)).rejects.toMatchObject({ kind: 'insufficient_balance' });
    expect(bad.calls.length).toBe(1);

    const notFound = makeClient([{ status: 404, body: '{}' }]);
    await expect(notFound.client.balance('m1', '+919876543210')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('rejects malformed response bodies as invalid_response', async () => {
    const { client } = makeClient([{ status: 200, body: '{"unexpected":true}' }]);
    await expect(client.balance('m1', '+919876543210')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('never logs the upstream response body', async () => {
    const { client } = makeClient([{ status: 400, body: '{"secret":"tok-LEAK"}' }]);
    const logged: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: reach into the private logger for the spy
    const logger = (client as any).logger;
    for (const level of ['error', 'warn', 'log']) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(JSON.stringify(args));
      });
    }
    await expect(client.credit(CREDIT)).rejects.toBeInstanceOf(CoreLoyaltyError);
    expect(logged.join(' ')).not.toContain('tok-LEAK');
  });
});
