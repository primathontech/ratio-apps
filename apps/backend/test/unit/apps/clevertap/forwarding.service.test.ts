import { Logger } from '@nestjs/common';
import { CLEVERTAP_REGIONS } from '@ratio-app/shared/constants/clevertap-events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClevertapEventsClient,
  type ClevertapUploadResult,
  UNREADABLE_BATCH_STATUS,
} from '../../../../src/modules/clevertap/events/clevertap-events.client';
import { ClevertapForwardingService } from '../../../../src/modules/clevertap/events/forwarding.service';
import { ORDER_UNMAPPABLE_NO_IDENTITY } from '../../../../src/modules/clevertap/events/order-event.mapper';
import { CLEVERTAP_WEBHOOK_TOPICS } from '../../../../src/modules/clevertap/webhooks/topics';
import {
  type ClevertapConfigRowFake,
  type ForwardedEventRow,
  makeFakeCrypto,
  makeFakeTrx,
  makeFakeUploader,
} from './helpers/fake-forwarding-trx';
import { CLEVERTAP_TEST_MERCHANT_ID } from './helpers/fixtures/envelopes';
import {
  ORDER_ID,
  ORDER_TOTAL_RUPEES,
  ordersPaidPayload,
  orderWithoutIdentityPayload,
} from './helpers/fixtures/order-payloads';

const MERCHANT = CLEVERTAP_TEST_MERCHANT_ID;
const PASSCODE = 'super-secret-passcode';
const PAID_KEY = `orders/paid:${ORDER_ID}`;

function config(over: Partial<ClevertapConfigRowFake> = {}): ClevertapConfigRowFake {
  return {
    merchantId: MERCHANT,
    accountId: 'ACCT-123',
    passcodeEnc: `enc:${PASSCODE}`,
    region: 'in1',
    serverEventsEnabled: true,
    clevertapEnabled: true,
    ...over,
  };
}

function build(opts: {
  config?: ClevertapConfigRowFake;
  existingRows?: ForwardedEventRow[];
  result?: ClevertapUploadResult;
}) {
  const fake = makeFakeTrx({
    ...(opts.config ? { config: opts.config } : {}),
    ...(opts.existingRows ? { existingRows: opts.existingRows } : {}),
  });
  const uploader = makeFakeUploader(opts.result);
  const hosts: string[] = [];
  const service = new ClevertapForwardingService(makeFakeCrypto(), (apiHost) => {
    hosts.push(apiHost);
    return uploader;
  });
  return { ...fake, uploader, hosts, service };
}

const paid = (svc: ClevertapForwardingService, trx: ReturnType<typeof makeFakeTrx>['trx']) =>
  svc.forwardOrder(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload, MERCHANT, trx);

const cancelled = (svc: ClevertapForwardingService, trx: ReturnType<typeof makeFakeTrx>['trx']) =>
  svc.forwardOrder(CLEVERTAP_WEBHOOK_TOPICS.ordersCancelled, ordersPaidPayload, MERCHANT, trx);

describe('ClevertapForwardingService — the happy path', () => {
  it('inserts the forwarded_events row BEFORE the outbound call, then updates it (A9)', async () => {
    const { service, trx, ops, rows } = build({ config: config() });
    await paid(service, trx);

    expect(ops).toEqual([
      'select:clevertap_configs',
      'insert:clevertap_forwarded_events:failed',
      'update:clevertap_forwarded_events:sent',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', error: null });
  });

  it('derives the idempotency key as `<event_type>:<order_id>` (A9)', async () => {
    const { service, trx, rows } = build({ config: config() });
    await paid(service, trx);
    expect(rows[0]?.idempotencyKey).toBe(PAID_KEY);
  });

  it('records the topic and the mapped CleverTap event on the row', async () => {
    const { service, trx, rows } = build({ config: config() });
    await paid(service, trx);
    expect(rows[0]).toMatchObject({ topic: 'orders/paid', clevertapEvent: 'Charged' });
  });

  it('sends the decrypted passcode and account id to the client', async () => {
    const { service, trx, uploader } = build({ config: config() });
    await paid(service, trx);
    expect(uploader.calls).toHaveLength(1);
    expect(uploader.calls[0]).toMatchObject({ accountId: 'ACCT-123', passcode: PASSCODE });
  });

  it('posts the mapped Charged record with RUPEE amounts (never /100)', async () => {
    const { service, trx, uploader } = build({ config: config() });
    await paid(service, trx);
    const record = uploader.calls[0]?.records[0];
    expect(record?.evtName).toBe('Charged');
    expect(record?.evtData?.Amount).toBe(ORDER_TOTAL_RUPEES);
    expect(record?.evtData?.Amount).toBe(1200);
  });
});

describe('ClevertapForwardingService — region host (TRD)', () => {
  it.each(
    Object.entries(CLEVERTAP_REGIONS),
  )('posts to the %s region host', async (region, meta) => {
    const { service, trx, hosts } = build({ config: config({ region }) });
    await paid(service, trx);
    expect(hosts).toEqual([meta.apiHost]);
  });

  it('falls back to the default region host for an unknown region value', async () => {
    const { service, trx, hosts } = build({ config: config({ region: 'atlantis1' }) });
    await paid(service, trx);
    expect(hosts).toEqual([CLEVERTAP_REGIONS.in1.apiHost]);
  });
});

describe('ClevertapForwardingService — idempotency (A9)', () => {
  it('a duplicate idempotency key does not call fetch a second time and does not throw', async () => {
    const existing: ForwardedEventRow = {
      merchantId: MERCHANT,
      idempotencyKey: PAID_KEY,
      topic: 'orders/paid',
      clevertapEvent: 'Charged',
      status: 'sent',
      error: null,
    };
    const { service, trx, uploader, rows, ops } = build({
      config: config(),
      existingRows: [existing],
    });

    await expect(paid(service, trx)).resolves.toBeUndefined();

    expect(uploader.calls).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(ops).toEqual([
      'select:clevertap_configs',
      'insert:clevertap_forwarded_events:duplicate',
    ]);
  });

  it('a redelivered orders/paid produces no second Charged (end-to-end through the mapper)', async () => {
    const { service, trx, uploader } = build({ config: config() });
    await paid(service, trx);
    await paid(service, trx);
    await paid(service, trx);
    expect(uploader.calls).toHaveLength(1);
  });

  it('does not suppress a different topic for the same order', async () => {
    const { service, trx, uploader, rows } = build({ config: config() });
    await paid(service, trx);
    await service.forwardOrder(
      CLEVERTAP_WEBHOOK_TOPICS.ordersCreate,
      ordersPaidPayload,
      MERCHANT,
      trx,
    );
    expect(uploader.calls.map((c) => c.records[0]?.evtName)).toEqual(['Charged', 'Order Created']);
    expect(rows.map((r) => r.idempotencyKey)).toEqual([PAID_KEY, `orders/create:${ORDER_ID}`]);
  });

  it('a failure between insert and update leaves status=failed, never a silent gap', async () => {
    const { service, trx, rows, ops, failNextUpdate } = build({ config: config() });
    failNextUpdate();

    await expect(paid(service, trx)).rejects.toThrow(/connection lost/);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(ops.indexOf('insert:clevertap_forwarded_events:failed')).toBeLessThan(
      ops.indexOf('update:clevertap_forwarded_events:threw'),
    );
  });
});

describe('ClevertapForwardingService — failures still resolve (TRD §6)', () => {
  it.each([
    500, 502, 503, 429, 401, 400,
  ])('a CleverTap %i marks the row failed and STILL resolves', async (status) => {
    const { service, trx, rows } = build({
      config: config(),
      result: { ok: false, status, error: `clevertap ${status}` },
    });

    await expect(paid(service, trx)).resolves.toBeUndefined();
    expect(rows[0]).toMatchObject({ status: 'failed', error: `clevertap ${status}` });
  });

  it('a timeout marks the row failed and still resolves', async () => {
    const { service, trx, rows } = build({
      config: config(),
      result: { ok: false, status: 0, error: 'timeout' },
    });
    await expect(paid(service, trx)).resolves.toBeUndefined();
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('a decrypt failure (rotated key) fails the row without failing the webhook', async () => {
    const fake = makeFakeTrx({ config: config({ passcodeEnc: 'not-a-ciphertext' }) });
    const uploader = makeFakeUploader();
    const service = new ClevertapForwardingService(makeFakeCrypto(), () => uploader);

    await expect(paid(service, fake.trx)).resolves.toBeUndefined();
    expect(uploader.calls).toHaveLength(0);
    expect(fake.rows[0]?.status).toBe('failed');
  });
});

describe('ClevertapForwardingService — skip paths (A12)', () => {
  const skipCases: [string, ClevertapConfigRowFake | undefined, string][] = [
    ['clevertapEnabled is false', config({ clevertapEnabled: false }), 'app disabled'],
    [
      'serverEventsEnabled is false',
      config({ serverEventsEnabled: false }),
      'server_events_enabled is false',
    ],
    ['passcode_enc is NULL', config({ passcodeEnc: null }), 'no passcode configured'],
    ['accountId is empty', config({ accountId: '' }), 'no account id configured'],
    ['there is no config row at all', undefined, 'no clevertap config row'],
  ];

  it.each(
    skipCases,
  )('does not call fetch when %s, and records status=skipped', async (_label, cfg, reason) => {
    const { service, trx, uploader, rows, ops } = build(cfg ? { config: cfg } : {});

    await expect(paid(service, trx)).resolves.toBeUndefined();

    expect(uploader.calls).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'skipped', error: reason });
    expect(ops).toEqual(['select:clevertap_configs', 'insert:clevertap_forwarded_events:skipped']);
  });

  it('skips all forwarding when the platform switch is off, even with a valid config', async () => {
    const fake = makeFakeTrx({ config: config() });
    const uploader = makeFakeUploader();
    const service = new ClevertapForwardingService(makeFakeCrypto(), () => uploader, false);

    await expect(paid(service, fake.trx)).resolves.toBeUndefined();

    expect(uploader.calls).toHaveLength(0);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ status: 'skipped', error: 'platform disabled' });
  });

  it('skips a topic listed in disabledTopics (per-topic mute) and never uploads', async () => {
    const { service, trx, uploader, rows } = build({
      config: config({ disabledTopics: ['orders/cancelled'] }),
    });

    await expect(cancelled(service, trx)).resolves.toBeUndefined();

    expect(uploader.calls).toHaveLength(0);
    expect(rows[0]).toMatchObject({ status: 'skipped', error: 'topic disabled' });
  });

  it('still forwards Charged when orders/paid is muted but chargedSource is server (source of truth)', async () => {
    const { service, trx, uploader } = build({
      config: config({ disabledTopics: ['orders/paid'], chargedSource: 'server' }),
    });

    await paid(service, trx);

    expect(uploader.calls).toHaveLength(1);
  });

  it('still forwards a topic that is NOT in disabledTopics', async () => {
    const { service, trx, uploader } = build({
      config: config({ disabledTopics: ['orders/cancelled'] }),
    });

    await paid(service, trx);

    expect(uploader.calls).toHaveLength(1);
  });

  it('skips the Charged forward when chargedSource is client (pixel owns Charged)', async () => {
    const { service, trx, uploader, rows } = build({ config: config({ chargedSource: 'client' }) });

    await expect(paid(service, trx)).resolves.toBeUndefined();

    expect(uploader.calls).toHaveLength(0);
    expect(rows[0]).toMatchObject({ status: 'skipped', error: 'charged sent client-side' });
  });

  it('forwards Charged when chargedSource is server', async () => {
    const { service, trx, uploader } = build({ config: config({ chargedSource: 'server' }) });

    await paid(service, trx);

    expect(uploader.calls).toHaveLength(1);
  });

  it('treats mysql2 TINYINT 0 as false for serverEventsEnabled', async () => {
    const { service, trx, uploader, rows } = build({
      config: config({ serverEventsEnabled: 0 as unknown as boolean }),
    });
    await paid(service, trx);
    expect(uploader.calls).toHaveLength(0);
    expect(rows[0]?.status).toBe('skipped');
  });

  it('a redelivered skip does not throw on the duplicate key either', async () => {
    const { service, trx } = build({ config: config({ serverEventsEnabled: false }) });
    await expect(paid(service, trx)).resolves.toBeUndefined();
    await expect(paid(service, trx)).resolves.toBeUndefined();
  });
});

describe('ClevertapForwardingService — unforwardable input', () => {
  it('no-ops for a null merchantId without touching the DB', async () => {
    const { service, trx, ops, uploader } = build({ config: config() });
    await service.forwardOrder(CLEVERTAP_WEBHOOK_TOPICS.ordersPaid, ordersPaidPayload, null, trx);
    expect(ops).toEqual([]);
    expect(uploader.calls).toHaveLength(0);
  });

  it('no-ops for a payload with no order id (no key ⇒ no row, no call)', async () => {
    const { service, trx, ops, uploader } = build({ config: config() });
    await service.forwardOrder(
      CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
      { total_price: '100.00' },
      MERCHANT,
      trx,
    );
    expect(ops).toEqual([]);
    expect(uploader.calls).toHaveLength(0);
  });

  it('records a payload with NO usable identity as SKIPPED, not failed', async () => {
    const { service, trx, uploader, rows, ops } = build({ config: config() });

    await expect(
      service.forwardOrder(
        CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
        orderWithoutIdentityPayload,
        MERCHANT,
        trx,
      ),
    ).resolves.toBeUndefined();

    expect(uploader.calls).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      idempotencyKey: PAID_KEY,
      topic: 'orders/paid',
      clevertapEvent: 'Charged',
      status: 'skipped',
      error: ORDER_UNMAPPABLE_NO_IDENTITY,
    });
    expect(rows[0]?.status).not.toBe('failed');
    expect(ops).toEqual(['insert:clevertap_forwarded_events:skipped']);
  });

  it('the skip reason names the missing identity and cites CleverTap 523', async () => {
    const { service, trx, rows } = build({ config: config() });
    await service.forwardOrder(
      CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
      orderWithoutIdentityPayload,
      MERCHANT,
      trx,
    );
    expect(rows[0]?.error).toContain('identity');
    expect(rows[0]?.error).toContain('523');
  });

  it('an unmappable payload for a null merchant still touches nothing', async () => {
    const { service, trx, ops, rows } = build({ config: config() });
    await service.forwardOrder(
      CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
      orderWithoutIdentityPayload,
      null,
      trx,
    );
    expect(ops).toEqual([]);
    expect(rows).toHaveLength(0);
  });

  it('a redelivered unmappable payload does not throw on the duplicate key', async () => {
    const { service, trx, rows } = build({ config: config() });
    const forward = () =>
      service.forwardOrder(
        CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
        orderWithoutIdentityPayload,
        MERCHANT,
        trx,
      );
    await expect(forward()).resolves.toBeUndefined();
    await expect(forward()).resolves.toBeUndefined();
    expect(rows).toHaveLength(1);
  });
});

describe('ClevertapForwardingService — the passcode never reaches a log (TRD §6)', () => {
  const captured: unknown[] = [];

  beforeEach(() => {
    captured.length = 0;
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        captured.push(...args);
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['success', { ok: true, status: 200 } as ClevertapUploadResult],
    ['failure', { ok: false, status: 500, error: 'clevertap 500' } as ClevertapUploadResult],
  ])('logs nothing containing the passcode on %s', async (_label, result) => {
    const { service, trx } = build({ config: config(), result });
    await paid(service, trx);

    expect(captured.length).toBeGreaterThan(0);
    const text = JSON.stringify(captured);
    expect(text).not.toContain(PASSCODE);
    expect(text).not.toContain('enc:');
  });

  it('logs nothing containing the shopper phone or email', async () => {
    const { service, trx } = build({ config: config() });
    await paid(service, trx);
    const text = JSON.stringify(captured);
    expect(text).not.toContain('9800000000');
    expect(text).not.toContain('buyer@example.com');
  });

  it('does log the operational triple (merchantId, topic, idempotencyKey)', async () => {
    const { service, trx } = build({ config: config() });
    await paid(service, trx);
    const text = JSON.stringify(captured);
    expect(text).toContain(MERCHANT);
    expect(text).toContain('orders/paid');
    expect(text).toContain(PAID_KEY);
  });
});

describe('ClevertapEventsClient — the outbound request (TRD R4)', () => {
  function captureFetch(response: { status?: number; body?: string } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      const status = response.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => response.body ?? '{"status":"success","processed":1,"unprocessed":[]}',
      };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it.each(Object.entries(CLEVERTAP_REGIONS))('POSTs to %s /1/upload', async (_r, meta) => {
    const { calls, fetchImpl } = captureFetch();
    const client = new ClevertapEventsClient({ apiHost: meta.apiHost, fetchImpl });
    await client.upload({ accountId: 'A', passcode: 'P', records: [{ type: 'event' }] });
    expect(calls[0]?.url).toBe(`${meta.apiHost}/1/upload`);
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('sends X-CleverTap-Account-Id and X-CleverTap-Passcode', async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    await client.upload({
      accountId: 'ACCT-123',
      passcode: PASSCODE,
      records: [{ type: 'event' }],
    });
    expect(calls[0]?.init.headers).toMatchObject({
      'X-CleverTap-Account-Id': 'ACCT-123',
      'X-CleverTap-Passcode': PASSCODE,
    });
  });

  it("wraps the records in CleverTap's { d: [...] } envelope", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    await client.upload({
      accountId: 'A',
      passcode: 'P',
      records: [{ type: 'event', evtName: 'Charged' }],
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      d: [{ type: 'event', evtName: 'Charged' }],
    });
  });

  it('reports a 5xx as a failure result rather than throwing', async () => {
    const { fetchImpl } = captureFetch({ status: 503 });
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    await expect(
      client.upload({ accountId: 'A', passcode: 'P', records: [{ type: 'event' }] }),
    ).resolves.toEqual({ ok: false, status: 503, error: 'clevertap 503' });
  });

  it('treats a 200 with batch status "fail" as a failure, surfacing the reason', async () => {
    const { fetchImpl } = captureFetch({ body: '{"status":"fail","error":"Invalid Account ID"}' });
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    const res = await client.upload({
      accountId: 'A',
      passcode: 'P',
      records: [{ type: 'event' }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('clevertap batch fail Invalid Account ID');
  });

  it('treats a 200 with batch status "partial" as a failure (we batch one record)', async () => {
    const { fetchImpl } = captureFetch({ body: '{"status":"partial","unprocessed":[{}]}' });
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    expect((await client.upload({ accountId: 'A', passcode: 'P', records: [] })).ok).toBe(false);
  });

  it('treats an unparseable 200 body as a FAILURE — fail closed', async () => {
    const { fetchImpl } = captureFetch({ body: 'OK' });
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    const res = await client.upload({ accountId: 'A', passcode: 'P', records: [] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe(`clevertap batch ${UNREADABLE_BATCH_STATUS}`);
  });

  it.each([
    ['an empty body', ''],
    ['an HTML error page', '<html><body>502 Bad Gateway</body></html>'],
    ['truncated JSON', '{"status":"suc'],
    ['valid JSON with no status field', '{"processed":1}'],
    ['a JSON array', '[]'],
  ])('fails closed on a 200 with %s', async (_label, body) => {
    const { fetchImpl } = captureFetch({ body });
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    expect((await client.upload({ accountId: 'A', passcode: 'P', records: [] })).ok).toBe(false);
  });

  it('reports a network error / abort as status 0 and never rejects', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com',
      fetchImpl,
    });
    await expect(client.upload({ accountId: 'A', passcode: 'P', records: [] })).resolves.toEqual({
      ok: false,
      status: 0,
      error: 'timeout',
    });
  });

  it('strips a trailing slash from apiHost so the path never doubles up', async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = new ClevertapEventsClient({
      apiHost: 'https://in1.api.clevertap.com/',
      fetchImpl,
    });
    await client.upload({ accountId: 'A', passcode: 'P', records: [] });
    expect(calls[0]?.url).toBe('https://in1.api.clevertap.com/1/upload');
  });
});

describe('ClevertapEventsClient — CleverTap diagnostics reach the operator', () => {
  const SHOPPER_PHONE = '+919876543210';
  const SHOPPER_EMAIL = 'priya@example.com';
  const PARTIAL_BODY = JSON.stringify({
    status: 'partial',
    processed: 1,
    unprocessed: [
      {
        status: 'fail',
        code: 509,
        error: 'Event name is mandatory',
        record: {
          identity: SHOPPER_PHONE,
          type: 'event',
          evtData: { Email: SHOPPER_EMAIL, Amount: 1559 },
        },
      },
    ],
  });

  function clientFor(response: { status?: number; body?: string }) {
    const fetchImpl = (async () => ({
      ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      status: response.status ?? 200,
      text: async () => response.body ?? '',
    })) as unknown as typeof fetch;
    return new ClevertapEventsClient({ apiHost: 'https://in1.api.clevertap.com', fetchImpl });
  }

  const captured: unknown[] = [];
  beforeEach(() => {
    captured.length = 0;
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        captured.push(...args);
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('surfaces unprocessed[0].code and .error in the persisted error string', async () => {
    const res = await clientFor({ body: PARTIAL_BODY }).upload({
      accountId: 'A',
      passcode: 'P',
      records: [{ type: 'event' }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('509');
    expect(res.error).toContain('Event name is mandatory');
  });

  it('NEVER puts unprocessed[].record in the error string (shopper PII)', async () => {
    const res = await clientFor({ body: PARTIAL_BODY }).upload({
      accountId: 'A',
      passcode: 'P',
      records: [{ type: 'event' }],
    });
    expect(res.error).not.toContain(SHOPPER_PHONE);
    expect(res.error).not.toContain(SHOPPER_EMAIL);
    expect(res.error).not.toContain('record');
    expect(res.error).not.toContain('evtData');
  });

  it('NEVER puts unprocessed[].record in any log call (shopper PII)', async () => {
    await clientFor({ body: PARTIAL_BODY }).upload({
      accountId: 'A',
      passcode: 'P',
      records: [{ type: 'event' }],
    });
    const text = JSON.stringify(captured);
    expect(captured.length).toBeGreaterThan(0);
    expect(text).not.toContain(SHOPPER_PHONE);
    expect(text).not.toContain(SHOPPER_EMAIL);
    expect(text).not.toContain('9876543210');
    expect(text).toContain('509');
    expect(text).toContain('Event name is mandatory');
  });

  it('surfaces a 401 body — "Invalid Credentials" names the wrong passcode', async () => {
    const res = await clientFor({
      status: 401,
      body: '{"status":"fail","error":"Invalid Credentials","code":401}',
    }).upload({ accountId: 'A', passcode: 'P', records: [{ type: 'event' }] });
    expect(res.error).toBe('clevertap 401 Invalid Credentials');
  });

  it('keeps a vendor code that DIFFERS from the HTTP status (e.g. 400 / 512)', async () => {
    const res = await clientFor({
      status: 400,
      body: '{"status":"fail","code":512,"error":"Invalid event structure"}',
    }).upload({ accountId: 'A', passcode: 'P', records: [{ type: 'event' }] });
    expect(res.error).toBe('clevertap 400 512 Invalid event structure');
  });

  it('falls back to the bare status when a non-2xx body carries nothing usable', async () => {
    const res = await clientFor({ status: 503, body: '<html>gateway</html>' }).upload({
      accountId: 'A',
      passcode: 'P',
      records: [{ type: 'event' }],
    });
    expect(res.error).toBe('clevertap 503');
  });

  it('bounds a pathologically long vendor error string', async () => {
    const res = await clientFor({
      status: 400,
      body: JSON.stringify({ status: 'fail', error: 'x'.repeat(5_000) }),
    }).upload({ accountId: 'A', passcode: 'P', records: [{ type: 'event' }] });
    expect((res.error ?? '').length).toBeLessThan(400);
  });
});

describe('ClevertapForwardingService — enqueue path (worker enabled)', () => {
  it('writes a queued outbox row with the payload instead of uploading inline', async () => {
    const fake = makeFakeTrx({ config: config() });
    const uploader = makeFakeUploader();
    const service = new ClevertapForwardingService(makeFakeCrypto(), () => uploader, true, true);

    await service.forwardOrder(
      CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
      ordersPaidPayload,
      MERCHANT,
      fake.trx,
    );

    expect(uploader.calls).toHaveLength(0);
    expect(fake.rows[0]).toMatchObject({
      merchantId: MERCHANT,
      topic: 'orders/paid',
      clevertapEvent: 'Charged',
      status: 'queued',
    });
    const records = JSON.parse(fake.rows[0]?.payload as string);
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
  });

  it('stays synchronous (uploads inline, no outbox row) when the worker flag is off', async () => {
    const fake = makeFakeTrx({ config: config() });
    const uploader = makeFakeUploader();
    const service = new ClevertapForwardingService(makeFakeCrypto(), () => uploader, true, false);

    await service.forwardOrder(
      CLEVERTAP_WEBHOOK_TOPICS.ordersPaid,
      ordersPaidPayload,
      MERCHANT,
      fake.trx,
    );

    expect(uploader.calls).toHaveLength(1);
    expect(fake.rows[0]?.status).not.toBe('queued');
  });
});
