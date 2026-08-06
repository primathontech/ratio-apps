import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { api } from './api';

beforeEach(() => {
  useMerchantStore.setState({ token: 'test-merchant' });
});

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

describe('api()', () => {
  it('unwraps a populated data field', async () => {
    mockFetchOnce({ status_code: 200, message: 'success', data: { foo: 'bar' }, request_id: 'x' });
    await expect(api('GET', '/whatever')).resolves.toEqual({ foo: 'bar' });
  });

  // Found via live browser testing: a brand-new merchant with no
  // credentials on file gets a real `{data: null}` response from
  // GET /admin/credentials — a legitimate business state, not an absent
  // field. `json.data ?? json` can't tell "data is explicitly null" apart
  // from "there is no data field at all", so it fell back to the whole
  // envelope object (truthy), and the Connect page rendered the
  // "credentials exist" branch with blank fields for a merchant that had
  // never generated any.
  it('returns null (not the envelope) when data is explicitly null', async () => {
    mockFetchOnce({ status_code: 200, message: 'success', data: null, request_id: 'x' });
    await expect(api('GET', '/admin/credentials?merchantId=uc-new-merchant')).resolves.toBeNull();
  });
});
