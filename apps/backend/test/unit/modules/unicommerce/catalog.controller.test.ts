import { describe, expect, it, vi } from 'vitest';
import { UcCatalogController } from '../../../../src/modules/unicommerce/controllers/catalog.controller';

function enabledFlags() {
  return { isEnabled: vi.fn().mockResolvedValue(true) };
}

describe('UcCatalogController', () => {
  it('count() returns the product count', async () => {
    const catalog = { count: vi.fn().mockResolvedValue(42) };
    const controller = new UcCatalogController(
      catalog as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.count({ ucMerchantId: 'm1' } as never);

    expect(result).toEqual({ count: 42 });
  });

  it('list() returns products for the requested page', async () => {
    const catalog = { list: vi.fn().mockResolvedValue([{ id: 'p1' }]) };
    const controller = new UcCatalogController(
      catalog as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.list({ ucMerchantId: 'm1' } as never, '2');

    expect(catalog.list).toHaveBeenCalledWith('m1', 2);
    expect(result).toEqual({ products: [{ id: 'p1' }] });
  });

  // Fix 2: an event-log write failure must never turn these real successes
  // into a rejected request handler.
  it('count() still returns the correct response when eventLog.record() rejects (Fix 2)', async () => {
    const catalog = { count: vi.fn().mockResolvedValue(42) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcCatalogController(
      catalog as never,
      eventLog as never,
      enabledFlags() as never,
    );

    const result = await controller.count({ ucMerchantId: 'm1' } as never);

    expect(result).toEqual({ count: 42 });
  });

  it('list() still returns the correct response when eventLog.record() rejects (Fix 2)', async () => {
    const catalog = { list: vi.fn().mockResolvedValue([{ id: 'p1' }]) };
    const eventLog = { record: vi.fn().mockRejectedValue(new Error('transient DB error')) };
    const controller = new UcCatalogController(
      catalog as never,
      eventLog as never,
      enabledFlags() as never,
    );

    const result = await controller.list({ ucMerchantId: 'm1' } as never, '1');

    expect(result).toEqual({ products: [{ id: 'p1' }] });
  });

  // TRD §6: product_sync flag off → accept-and-no-op, never hard-reject.
  it('count() returns {count: 0} without touching the catalog service when product_sync is disabled', async () => {
    const catalog = { count: vi.fn() };
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const controller = new UcCatalogController(
      catalog as never,
      { record: vi.fn() } as never,
      flags as never,
    );

    const result = await controller.count({ ucMerchantId: 'm1' } as never);

    expect(flags.isEnabled).toHaveBeenCalledWith('product_sync', 'm1');
    expect(catalog.count).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 0 });
  });

  it('list() returns an empty product list without touching the catalog service when product_sync is disabled', async () => {
    const catalog = { list: vi.fn() };
    const flags = { isEnabled: vi.fn().mockResolvedValue(false) };
    const controller = new UcCatalogController(
      catalog as never,
      { record: vi.fn() } as never,
      flags as never,
    );

    const result = await controller.list({ ucMerchantId: 'm1' } as never, '1');

    expect(flags.isEnabled).toHaveBeenCalledWith('product_sync', 'm1');
    expect(catalog.list).not.toHaveBeenCalled();
    expect(result).toEqual({ products: [] });
  });

  // Found via local verification: a downstream Ratio-call failure (network
  // error, expired OAuth token, Ratio 5xx) must degrade to a clean response,
  // not an uncaught exception crashing the request with a raw 500.
  it('count() returns {count: 0} instead of throwing when the catalog service rejects', async () => {
    const catalog = {
      count: vi.fn().mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
    };
    const controller = new UcCatalogController(
      catalog as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.count({ ucMerchantId: 'm1' } as never);

    expect(result).toEqual({ count: 0 });
  });

  it('list() returns {products: []} instead of throwing when the catalog service rejects', async () => {
    const catalog = {
      list: vi.fn().mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
    };
    const controller = new UcCatalogController(
      catalog as never,
      { record: vi.fn() } as never,
      enabledFlags() as never,
    );

    const result = await controller.list({ ucMerchantId: 'm1' } as never, '1');

    expect(result).toEqual({ products: [] });
  });

  // Found via manual testing: a degraded (no Ratio oauth_tokens row) catalog
  // pull was completely invisible in the admin app's "All Activity" page —
  // the controller returned early from the catch block before ever writing
  // an event-log row, unlike every other inbound controller (e.g.
  // inventory.controller.ts logs regardless of the downstream result).
  it('count() still logs the event (as failed) when the catalog service rejects', async () => {
    const catalog = {
      count: vi.fn().mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
    };
    const eventLog = { record: vi.fn() };
    const controller = new UcCatalogController(
      catalog as never,
      eventLog as never,
      enabledFlags() as never,
    );

    await controller.count({ ucMerchantId: 'm1' } as never);

    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', flow: 'catalog', result: 'failed' }),
    );
  });

  it('list() still logs the event (as failed) when the catalog service rejects', async () => {
    const catalog = {
      list: vi.fn().mockRejectedValue(new Error('no Ratio oauth_tokens row for merchant m1')),
    };
    const eventLog = { record: vi.fn() };
    const controller = new UcCatalogController(
      catalog as never,
      eventLog as never,
      enabledFlags() as never,
    );

    await controller.list({ ucMerchantId: 'm1' } as never, '1');

    expect(eventLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: 'm1', flow: 'catalog', result: 'failed' }),
    );
  });
});
