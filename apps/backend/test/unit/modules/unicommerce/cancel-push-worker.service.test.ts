import { describe, expect, it, vi } from 'vitest';
import { UcCancelPushWorkerService } from '../../../../src/modules/unicommerce/services/cancel-push-worker.service';

describe('UcCancelPushWorkerService.push', () => {
  it('pushes a cancel and returns alreadyDispatched=false on success', async () => {
    const credentials = { getUcUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = { post: vi.fn().mockResolvedValue({ status: 'success', message: 'ok', data: null }) };
    const svc = new UcCancelPushWorkerService(credentials as never, httpClient as never, { clientId: 'x', securityKey: 'y', baseUrl: 'https://genericproxy.unicommerce.com' });

    const result = await svc.push('m1', 'order-1', 'UC-999', 'customer requested');

    expect(result.alreadyDispatched).toBe(false);
    expect(httpClient.post).toHaveBeenCalledWith(
      'https://genericproxy.unicommerce.com/uc/v1/order/cancel',
      { saleOrderCode: 'UC-999', cancellationReason: 'customer requested' },
      { headers: { clientid: 'x', merchantid: 'merchant-uc-login', securitykey: 'y' } },
    );
  });

  it("surfaces alreadyDispatched=true instead of throwing, reading UC's status:failure response body (not a thrown error)", async () => {
    const credentials = { getUcUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({ status: 'failure', message: 'Order already dispatched, cannot cancel', data: null }),
    };
    const svc = new UcCancelPushWorkerService(credentials as never, httpClient as never, { clientId: 'x', securityKey: 'y', baseUrl: 'https://genericproxy.unicommerce.com' });

    const result = await svc.push('m1', 'order-1', 'UC-999', 'customer requested');

    expect(result.alreadyDispatched).toBe(true);
  });

  it('throws when the merchant has no UC username on file', async () => {
    const credentials = { getUcUsername: vi.fn().mockResolvedValue(null) };
    const httpClient = { post: vi.fn() };
    const svc = new UcCancelPushWorkerService(credentials as never, httpClient as never, { clientId: 'x', securityKey: 'y', baseUrl: 'https://genericproxy.unicommerce.com' });

    await expect(svc.push('m1', 'order-1', 'UC-999', 'customer requested')).rejects.toThrow(
      'no Unicommerce username on file for merchant m1',
    );
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('propagates a transport-level error (HTTP failure) unchanged', async () => {
    const credentials = { getUcUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = { post: vi.fn().mockRejectedValue(new Error('upstream timeout')) };
    const svc = new UcCancelPushWorkerService(credentials as never, httpClient as never, { clientId: 'x', securityKey: 'y', baseUrl: 'https://genericproxy.unicommerce.com' });

    await expect(svc.push('m1', 'order-1', 'UC-999', 'customer requested')).rejects.toThrow(
      'upstream timeout',
    );
  });

  it('throws on status:failure that is NOT the already-dispatched message, so it hits the normal retry ladder', async () => {
    const credentials = { getUcUsername: vi.fn().mockResolvedValue('merchant-uc-login') };
    const httpClient = {
      post: vi.fn().mockResolvedValue({ status: 'failure', message: 'validation error: bad SKU', data: null }),
    };
    const svc = new UcCancelPushWorkerService(credentials as never, httpClient as never, { clientId: 'x', securityKey: 'y', baseUrl: 'https://genericproxy.unicommerce.com' });

    await expect(svc.push('m1', 'order-1', 'UC-999', 'customer requested')).rejects.toThrow(
      'validation error: bad SKU',
    );
  });
});
