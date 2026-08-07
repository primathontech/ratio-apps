import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import type { Db, InboundJobType } from '../src/db';
import type { InboundEventMessage } from '../src/kafka';
import type { Logger } from '../src/logger';

const noopLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

type CredentialStatus = 'active' | 'paused' | 'uninstalled';

interface FakeDbOverrides {
  validateApiKey?: (apiKey: string) => Promise<string | null>;
  getCredentialStatus?: (merchantId: string) => Promise<CredentialStatus | null>;
  resolveOrderItem?: (orderItemId: string) => Promise<{ merchantId: string } | null>;
}

function makeHarness(
  opts: { overrides?: FakeDbOverrides; publishImpl?: (msg: InboundEventMessage) => Promise<void> } = {},
): { app: ReturnType<typeof buildApp>; db: Db; jobs: { id: string; merchantId: string; type: string; payload: Record<string, unknown> }[]; publish: ReturnType<typeof vi.fn> } {
  const jobs: { id: string; merchantId: string; type: string; payload: Record<string, unknown> }[] = [];
  const db: Db = {
    validateApiKey: vi.fn(async (apiKey: string): Promise<string | null> =>
      apiKey === 'valid-key' ? 'merchant-1' : null,
    ),
    getCredentialStatus: vi.fn(async (): Promise<CredentialStatus | null> => 'active'),
    touchInboundCall: vi.fn(async (): Promise<void> => undefined),
    resolveOrderItem: vi.fn(async (orderItemId: string): Promise<{ merchantId: string } | null> =>
      orderItemId === 'item-1' ? { merchantId: 'merchant-1' } : null,
    ),
    insertJob: vi.fn(async (merchantId: string, type: InboundJobType, payload: Record<string, unknown>): Promise<string> => {
      const id = `job-${jobs.length + 1}`;
      jobs.push({ id, merchantId, type, payload });
      return id;
    }),
    close: vi.fn(async (): Promise<void> => undefined),
    ...opts.overrides,
  };
  const publish = opts.publishImpl ? vi.fn(opts.publishImpl) : vi.fn(async (): Promise<void> => undefined);
  const app = buildApp({ db, publish, logger: noopLogger });
  return { app, db, jobs, publish };
}

const validStatusBody = {
  orderItems: [
    { orderItemId: 'item-1', status: 'DISPATCHED', IsReverse: false, updated: '2026-08-06T14:05:00+05:30' },
  ],
};

const authHeaders = { apikey: 'valid-key' };

describe('GET /health', () => {
  it('returns 200 { ok: true } without auth', async () => {
    const { app } = makeHarness();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('POST /unicommerce/api/v1/order/:orderId', () => {
  it('enqueues a status_notify job per known item and returns the SUCCESS shape', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'status_notify', merchantId: 'merchant-1' });
    expect(jobs[0].payload).toEqual({
      orderId: 'order-123',
      orderItemId: 'item-1',
      status: 'DISPATCHED',
      IsReverse: false,
      updated: '2026-08-06T14:05:00+05:30',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ jobId: 'job-1', merchantId: 'merchant-1', type: 'status_notify' });
    await app.close();
  });

  it('reports unknown orderItemId per item without enqueuing that item', async () => {
    const { app, jobs, publish } = makeHarness();
    const body = {
      orderItems: [
        { orderItemId: 'item-1', status: 'DISPATCHED', IsReverse: false, updated: '2026-08-06T14:05:00+05:30' },
        { orderItemId: 'missing', status: 'PICKED', IsReverse: false, updated: '2026-08-06T14:05:00+05:30' },
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'SUCCESS',
      orderItems: [
        { orderItemId: 'item-1' },
        { orderItemId: 'missing', errorMessage: 'unknown orderItemId' },
      ],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ orderItemId: 'item-1' });
    expect(publish).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('reports unknown orderItemId when the item belongs to a different merchant', async () => {
    const { app, jobs, publish } = makeHarness({
      overrides: {
        resolveOrderItem: vi.fn(async (): Promise<{ merchantId: string } | null> => ({ merchantId: 'other-merchant' })),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'SUCCESS',
      orderItems: [{ orderItemId: 'item-1', errorMessage: 'unknown orderItemId' }],
    });
    expect(jobs).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    await app.close();
  });

  it('401 with the guard message when the apikey header is missing', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: {},
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: 'missing apiKey header' });
    expect(jobs).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    await app.close();
  });

  it('401 with the guard message when the apikey is invalid or expired', async () => {
    const { app } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: { apikey: 'bad-key' },
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: 'invalid or expired apiKey' });
    await app.close();
  });

  it('403 with the kill-switch message when the merchant is paused', async () => {
    const { app } = makeHarness({
      overrides: {
        getCredentialStatus: vi.fn(async (): Promise<CredentialStatus | null> => 'paused'),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: 'merchant is paused — inbound calls blocked' });
    await app.close();
  });

  it('403 with the kill-switch message when the merchant is uninstalled', async () => {
    const { app } = makeHarness({
      overrides: {
        getCredentialStatus: vi.fn(async (): Promise<CredentialStatus | null> => 'uninstalled'),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ message: 'merchant is uninstalled — inbound calls blocked' });
    await app.close();
  });

  it('400 mirroring the backend ZodValidationPipe when the body fails validation', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: { orderItems: [{ orderItemId: 'item-1', status: 'DISPATCHED', updated: 'x' }] }, // missing IsReverse
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: 'validation failed', error_code: 'INVALID_REQUEST_BODY' });
    expect(jobs).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /unicommerce/api/v1/updateInventory', () => {
  const validBody = {
    inventoryList: [{ productId: 'p1', variantId: 'v1', inventory: '24' }],
  };

  it('enqueues an inventory_update job and returns the SUCCESS shape', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/updateInventory',
      headers: authHeaders,
      payload: validBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'SUCCESS', failedProductList: [] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'inventory_update', merchantId: 'merchant-1' });
    expect(jobs[0].payload).toEqual({ productId: 'p1', variantId: 'v1', inventory: '24' });
    expect(publish).toHaveBeenCalledWith({ jobId: 'job-1', merchantId: 'merchant-1', type: 'inventory_update' });
    await app.close();
  });

  it('preserves optional hsnCode/facilityCode in the job payload', async () => {
    const { app, jobs } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/updateInventory',
      headers: authHeaders,
      payload: {
        inventoryList: [
          { productId: 'p1', variantId: 'v1', inventory: '24', hsnCode: '6109', facilityCode: 'DEL-BLR-01' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(jobs[0].payload).toEqual({
      productId: 'p1',
      variantId: 'v1',
      inventory: '24',
      hsnCode: '6109',
      facilityCode: 'DEL-BLR-01',
    });
    await app.close();
  });

  it('enqueues an item with an unknown variantId (mirrors the sync path: no local variant catalog; Ratio decides at apply time)', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/updateInventory',
      headers: authHeaders,
      payload: { inventoryList: [{ productId: 'p-unknown', variantId: 'v-unknown', inventory: '5' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'SUCCESS', failedProductList: [] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ productId: 'p-unknown', variantId: 'v-unknown', inventory: '5' });
    expect(publish).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('accepts an empty inventoryList with SUCCESS and enqueues nothing (mirrors the sync controller: no .min(1) on the schema)', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/updateInventory',
      headers: authHeaders,
      payload: { inventoryList: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'SUCCESS', failedProductList: [] });
    expect(jobs).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    await app.close();
  });

  it('400 when the body fails validation (inventory is a required string)', async () => {
    const { app, jobs, publish } = makeHarness();
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/updateInventory',
      headers: authHeaders,
      payload: { inventoryList: [{ productId: 'p1', variantId: 'v1' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: 'validation failed', error_code: 'INVALID_REQUEST_BODY' });
    expect(jobs).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('kafka publish failure', () => {
  it('still returns 200 and keeps the job row (log-and-swallow)', async () => {
    const { app, jobs } = makeHarness({
      publishImpl: async (): Promise<void> => {
        throw new Error('kafka broker unreachable');
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/unicommerce/api/v1/order/order-123',
      headers: authHeaders,
      payload: validStatusBody,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'SUCCESS', orderItems: [{ orderItemId: 'item-1' }] });
    expect(jobs).toHaveLength(1); // durable row written regardless of Kafka
    await app.close();
  });
});
