import { describe, expect, it, vi } from 'vitest';
import { UcOrderPushWorkerService } from '../../../../src/modules/unicommerce/services/order-push-worker.service';

describe('UcOrderPushWorkerService.push', () => {
  it('sends clientid/merchantid/securitykey headers and the real order payload (no saleOrderDTO wrapper)', async () => {
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({ status: 'success', message: 'Order created successfully', data: null }),
    };
    const config = { clientId: 'ratio-partner-id', securityKey: 'shared-secret', baseUrl: 'https://genericproxy.unicommerce.com' };
    const worker = new UcOrderPushWorkerService(credentials as never, httpClient as never, config);

    const order = { id: 'ratio-order-1', orderDate: '2026-01-05 16:00:00' } as never;
    const result = await worker.push({ merchantId: 'm1', ratioOrderId: 'order-1', order });

    expect(httpClient.post).toHaveBeenCalledWith(
      'https://genericproxy.unicommerce.com/uc/v1/order',
      order,
      {
        headers: {
          clientid: 'ratio-partner-id',
          merchantid: 'merchant-uc-login',
          securitykey: 'shared-secret',
        },
      },
    );
    expect(result.status).toBe('success');
  });

  it('throws when the merchant has no UC username on file (cannot build the merchantid header)', async () => {
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue(null) };
    const httpClient = { post: vi.fn() };
    const worker = new UcOrderPushWorkerService(credentials as never, httpClient as never, {
      clientId: 'x',
      securityKey: 'y',
      baseUrl: 'https://genericproxy.unicommerce.com',
    });

    await expect(
      worker.push({ merchantId: 'm1', ratioOrderId: 'order-1', order: {} as never }),
    ).rejects.toThrow('no Unicommerce ratio_username on file for merchant m1');
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it("throws when the response resolves with status: 'failure', surfacing Unicommerce's message", async () => {
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({
        status: 'failure',
        message: 'SKU not found for item X',
        data: null,
      }),
    };
    const worker = new UcOrderPushWorkerService(credentials as never, httpClient as never, {
      clientId: 'x',
      securityKey: 'y',
      baseUrl: 'https://genericproxy.unicommerce.com',
    });

    await expect(
      worker.push({ merchantId: 'm1', ratioOrderId: 'order-1', order: {} as never }),
    ).rejects.toThrow('SKU not found for item X');
  });

  it("throws a generic error when status: 'failure' has no message (defaults conservatively)", async () => {
    const credentials = { getRatioUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({ status: 'failure', data: null }),
    };
    const worker = new UcOrderPushWorkerService(credentials as never, httpClient as never, {
      clientId: 'x',
      securityKey: 'y',
      baseUrl: 'https://genericproxy.unicommerce.com',
    });

    await expect(
      worker.push({ merchantId: 'm1', ratioOrderId: 'order-1', order: {} as never }),
    ).rejects.toThrow(/status:failure/);
  });
});
