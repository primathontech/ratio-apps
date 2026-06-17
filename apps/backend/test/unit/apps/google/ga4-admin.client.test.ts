import { describe, expect, it, vi } from 'vitest';
import { Ga4AdminClient } from '../../../../src/modules/google/ga4/ga4-admin.client';

const BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const TOKEN = 'ya29.ga4-token';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('Ga4AdminClient.listWebMeasurementIds', () => {
  it('collects WEB_DATA_STREAM measurement ids across properties with a Bearer token', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      expect(auth).toBe(`Bearer ${TOKEN}`);
      if (u.endsWith('/accountSummaries')) {
        return Promise.resolve(json({
          accountSummaries: [{ propertySummaries: [{ property: 'properties/11', displayName: 'Store' }] }],
        }));
      }
      return Promise.resolve(json({
        dataStreams: [
          { type: 'WEB_DATA_STREAM', displayName: 'Web', webStreamData: { measurementId: 'G-ABC123' } },
          { type: 'IOS_APP_DATA_STREAM', webStreamData: {} },
        ],
      }));
    }) as unknown as typeof fetch;

    const client = new Ga4AdminClient({ getAccessToken: async () => TOKEN, fetchImpl });
    const streams = await client.listWebMeasurementIds();

    expect(streams).toEqual([{ measurementId: 'G-ABC123', displayName: 'Web', property: 'properties/11' }]);
    expect(calls[0]).toBe(`${BASE}/accountSummaries`);
    expect(calls[1]).toBe(`${BASE}/properties/11/dataStreams`);
  });

  it('throws Ga4AdminError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ error: { message: 'denied' } }, 403))) as unknown as typeof fetch;
    const client = new Ga4AdminClient({ getAccessToken: async () => TOKEN, fetchImpl });
    await expect(client.listWebMeasurementIds()).rejects.toThrow('denied');
  });
});
