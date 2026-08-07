import { describe, expect, it, vi } from 'vitest';
import { ClevertapCatalogClient } from '../../../../src/modules/clevertap/events/clevertap-catalog.client';

const API_HOST = 'https://eu1.api.clevertap.com';
const PRESIGNED = 'https://s3.example.com/bucket/catalog.csv?sig=abc';

interface FakeRes {
  ok: boolean;
  status: number;
  body?: unknown;
}

function res({ ok, status, body }: FakeRes) {
  return {
    ok,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function makeFetch(responses: FakeRes[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch call');
    return res(next);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function client(fetchImpl: typeof fetch) {
  return new ClevertapCatalogClient({ apiHost: API_HOST, fetchImpl });
}

const input = {
  accountId: 'ACCT-1',
  passcode: 'secret',
  name: 'products',
  creator: 'ratio-clevertap',
  email: 'ops@example.com',
  csv: 'Name,ImageURL,Category\nWidget,,Toys\n',
  replace: true,
};

describe('ClevertapCatalogClient.uploadCatalog — 3-step contract', () => {
  it('runs get_catalog_url → PUT csv → upload_catalog_completed and returns ok', async () => {
    const { impl, calls } = makeFetch([
      { ok: true, status: 200, body: { presignedS3URL: PRESIGNED, status: 'success' } },
      { ok: true, status: 200 },
      { ok: true, status: 200, body: { status: 'success' } },
    ]);

    const result = await client(impl).uploadCatalog(input);

    expect(result).toEqual({ ok: true, status: 200 });
    expect(calls).toHaveLength(3);

    expect(calls[0]?.url).toBe(`${API_HOST}/get_catalog_url`);
    expect(calls[0]?.init.method).toBe('POST');
    const h0 = calls[0]?.init.headers as Record<string, string>;
    expect(h0['X-CleverTap-Account-Id']).toBe('ACCT-1');
    expect(h0['X-CleverTap-Passcode']).toBe('secret');
    expect(calls[0]?.init.body).toBeUndefined();

    expect(calls[1]?.url).toBe(PRESIGNED);
    expect(calls[1]?.init.method).toBe('PUT');
    expect(calls[1]?.init.body).toBe(input.csv);

    expect(calls[2]?.url).toBe(`${API_HOST}/upload_catalog_completed`);
    expect(calls[2]?.init.method).toBe('POST');
    expect(JSON.parse(calls[2]?.init.body as string)).toEqual({
      name: 'products',
      creator: 'ratio-clevertap',
      email: 'ops@example.com',
      url: PRESIGNED,
      replace: true,
      override: false,
      isLocationCatalog: false,
    });
  });

  it('fails when get_catalog_url is not ok and never PUTs', async () => {
    const { impl, calls } = makeFetch([
      { ok: false, status: 401, body: { Error: 'bad passcode' } },
    ]);

    const result = await client(impl).uploadCatalog(input);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain('bad passcode');
    expect(calls).toHaveLength(1);
  });

  it('fails when the presigned url field is absent', async () => {
    const { impl } = makeFetch([{ ok: true, status: 200, body: { status: 'success' } }]);

    const result = await client(impl).uploadCatalog(input);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing upload url');
  });

  it('fails when the csv PUT is rejected and never calls completion', async () => {
    const { impl, calls } = makeFetch([
      { ok: true, status: 200, body: { presignedS3URL: PRESIGNED, status: 'success' } },
      { ok: false, status: 403 },
    ]);

    const result = await client(impl).uploadCatalog(input);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(calls).toHaveLength(2);
  });

  it('fails when completion returns status fail', async () => {
    const { impl } = makeFetch([
      { ok: true, status: 200, body: { presignedS3URL: PRESIGNED, status: 'success' } },
      { ok: true, status: 200 },
      { ok: true, status: 200, body: { status: 'fail', Error: 'bad header row' } },
    ]);

    const result = await client(impl).uploadCatalog(input);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('fail');
  });
});
