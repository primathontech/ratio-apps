import { describe, expect, it, vi } from 'vitest';
import type { WizzySyncMessage } from '../../../../src/modules/wizzy/catalog/wizzy-sync.queue';
import { WizzySyncWorker } from '../../../../src/modules/wizzy/catalog/wizzy-sync.worker';
import type { RatioProduct } from '../../../../src/modules/wizzy/catalog/wizzy-transform';

/**
 * The worker's message-processing contract after the fetch-by-id change:
 *   - `upsert` with only a productId → fetch authoritative product by id, sync it.
 *   - `upsert` carrying a legacy `product` → honor it directly (rollover safety).
 *   - `delete` → delete by id; never fetch.
 * `process` is private; we exercise it through `drainOnce`, driving the queue mock.
 */
function makeWorker(msgs: WizzySyncMessage[]) {
  const receive = vi.fn(async () => msgs.map((body, i) => ({ body, receiptHandle: `rh-${i}` })));
  const ack = vi.fn(async () => {});
  const queue = { receive, ack } as never;

  const syncProduct = vi.fn(async () => ({ updated: 1, errored: 0 }));
  const deleteProduct = vi.fn(async () => {});
  const catalogSync = { syncProduct, deleteProduct } as never;

  const fetched: RatioProduct = {
    id: 'p1',
    title: 'Fetched by id',
    handle: 'fetched-by-id',
    images: [{ src: 'https://x/i.jpg' }],
    variants: [{ id: 'p1', price: 499, availableForSale: true }],
  };
  const getById = vi.fn(async () => fetched);
  const products = { listAll: vi.fn(), getById } as never;

  const worker = new WizzySyncWorker(queue, catalogSync, products);
  return { worker, syncProduct, deleteProduct, getById, ack, fetched };
}

describe('WizzySyncWorker — fetch-by-id on upsert', () => {
  it('fetches the authoritative product by id, then syncs it', async () => {
    const { worker, syncProduct, getById, ack } = makeWorker([
      { op: 'upsert', merchantId: 'm1', productId: 'p1' },
    ]);

    await worker.drainOnce();

    expect(getById).toHaveBeenCalledWith('m1', 'p1');
    expect(syncProduct).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ id: 'p1' }),
      'webhook',
    );
    expect(ack).toHaveBeenCalledWith(expect.anything(), ['rh-0']);
  });

  it('honors a legacy message that still carries the parsed product (no fetch)', async () => {
    const legacy: RatioProduct = {
      id: 'legacy-1',
      title: 'Legacy',
      handle: 'legacy',
      images: [{ src: 'https://x/l.jpg' }],
      variants: [{ id: 'legacy-1', price: 199, availableForSale: true }],
    };
    const { worker, syncProduct, getById } = makeWorker([
      { op: 'upsert', merchantId: 'm1', productId: 'legacy-1', product: legacy },
    ]);

    await worker.drainOnce();

    expect(getById).not.toHaveBeenCalled();
    expect(syncProduct).toHaveBeenCalledWith('m1', legacy, 'webhook');
  });

  it('deletes by id without fetching on a delete message', async () => {
    const { worker, deleteProduct, getById, syncProduct } = makeWorker([
      { op: 'delete', merchantId: 'm1', productId: 'gone-1' },
    ]);

    await worker.drainOnce();

    expect(deleteProduct).toHaveBeenCalledWith('m1', 'gone-1');
    expect(getById).not.toHaveBeenCalled();
    expect(syncProduct).not.toHaveBeenCalled();
  });

  it('does not ack when the fetch fails (message redelivers)', async () => {
    const { worker, getById, ack } = makeWorker([
      { op: 'upsert', merchantId: 'm1', productId: 'p1' },
    ]);
    getById.mockRejectedValueOnce(new Error('by-id 500'));

    await worker.drainOnce();

    expect(ack).not.toHaveBeenCalled();
  });
});
