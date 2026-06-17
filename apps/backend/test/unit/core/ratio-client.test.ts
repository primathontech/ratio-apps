import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { RatioClient } from '../../../src/core/ratio-client/ratio.client';

function makeClient(base = 'https://api.test') {
  return new RatioClient(base);
}

describe('RatioClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const schema = z.object({ ok: z.boolean(), n: z.number() });

  it('parses + returns a valid response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, n: 1 }), { status: 200 }));
    const client = makeClient();
    const result = await client.request('/x', schema);
    expect(result).toEqual({ ok: true, n: 1 });
  });

  it('throws HttpException on non-2xx upstream', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ msg: 'no' }), { status: 502 }));
    const client = makeClient();
    await expect(client.request('/x', schema)).rejects.toThrow(HttpException);
  });

  it('error response does NOT include upstream body in details (Finding #12)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ secret: 'should-not-leak' }), { status: 500 }),
    );
    const client = makeClient();
    try {
      await client.request('/x', schema);
      throw new Error('expected throw');
    } catch (e) {
      const ex = e as HttpException;
      const resp = ex.getResponse() as { details?: { body?: unknown } };
      expect(resp.details?.body).toBeUndefined();
    }
  });

  it('throws RATIO_RESPONSE_VALIDATION when upstream shape does not match schema', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }));
    const client = makeClient();
    await expect(client.request('/x', schema)).rejects.toMatchObject({
      response: { error_code: 'RATIO_RESPONSE_VALIDATION' },
    });
  });

  it('attaches Authorization: Bearer when accessToken is given', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, n: 0 }), { status: 200 }));
    const client = makeClient();
    await client.request('/x', schema, { accessToken: 'tok_xyz' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok_xyz');
  });

  it('serializes body as JSON when provided', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, n: 0 }), { status: 200 }));
    const client = makeClient();
    await client.request('/x', schema, { method: 'POST', body: { a: 1 } });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"a":1}');
    expect(init.method).toBe('POST');
  });

  it('omits body for GET when no body is given', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, n: 0 }), { status: 200 }));
    const client = makeClient();
    await client.request('/x', schema);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });
});
