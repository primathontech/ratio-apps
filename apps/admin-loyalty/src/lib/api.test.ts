import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/useMerchantStore', () => ({
  useMerchantStore: { getState: () => ({ token: 'test-token' }) },
}));

import { ApiException, api } from './api';

function mockFetch(status: number, body: unknown) {
  const impl = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', impl);
  return impl;
}

describe('api()', () => {
  it('prepends the /loyalty vendor namespace and unwraps the data envelope', async () => {
    const impl = mockFetch(200, {
      status_code: 200,
      message: 'ok',
      data: { programName: 'Coins' },
    });
    const res = await api<{ programName: string }>('GET', '/api/loyalty-config');
    expect(res).toEqual({ programName: 'Coins' });
    const url = String(impl.mock.calls[0]![0]);
    expect(url).toContain('/loyalty/api/loyalty-config');
  });

  it('attaches the bearer token from the merchant store', async () => {
    const impl = mockFetch(200, { data: {} });
    await api('GET', '/api/loyalty-config');
    const init = impl.mock.calls[0]![1] as unknown as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token');
  });

  it('throws ApiException with error_code on non-2xx', async () => {
    mockFetch(422, { status_code: 422, message: 'email required', error_code: 'EMAIL_REQUIRED' });
    await expect(api('POST', '/api/exports', { filters: [] })).rejects.toMatchObject({
      name: 'ApiException',
      status: 422,
      errorCode: 'EMAIL_REQUIRED',
    });
    expect(new ApiException('x', 500).status).toBe(500);
  });
});
