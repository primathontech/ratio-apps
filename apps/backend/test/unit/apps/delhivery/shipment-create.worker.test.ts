import { describe, expect, it, vi } from 'vitest';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import {
  DELHIVERY_QUEUE_NAMES,
  type DelhiveryShipmentMessage,
} from '../../../../src/modules/delhivery/shipments/shipment-create.queue';
import { ShipmentCreateWorker } from '../../../../src/modules/delhivery/shipments/shipment-create.worker';
import type { DelhiveryShipmentService } from '../../../../src/modules/delhivery/shipments/shipment.service';

function fakeQueue(messages: DelhiveryShipmentMessage[]) {
  const received = messages.map((body, i) => ({ body, receiptHandle: `rh-${i}` }));
  return {
    receive: vi.fn(async () => received),
    ack: vi.fn(async () => undefined),
  } as unknown as QueueService;
}

function fakeShipments(overrides: Partial<Record<'createForOrder' | 'cancelForOrder' | 'recreateForOrder', unknown>> = {}) {
  return {
    createForOrder: vi.fn(async () => ({ awb: 'AWB1' })),
    cancelForOrder: vi.fn(async () => null),
    recreateForOrder: vi.fn(async () => null),
    ...overrides,
  } as unknown as DelhiveryShipmentService;
}

describe('ShipmentCreateWorker', () => {
  it('create op → createForOrder then ack', async () => {
    const shipments = fakeShipments();
    const queue = fakeQueue([{ op: 'create', merchantId: 'm1', orderId: 'ord_1', orderNumber: '1001' }]);
    const worker = new ShipmentCreateWorker(queue, shipments);

    await worker.drainOnce();

    expect(shipments.createForOrder).toHaveBeenCalledWith('m1', {
      orderId: 'ord_1',
      orderNumber: '1001',
    });
    expect(queue.ack).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, ['rh-0']);
  });

  it('cancel op → cancelForOrder (orders/cancelled chain)', async () => {
    const shipments = fakeShipments();
    const queue = fakeQueue([{ op: 'cancel', merchantId: 'm1', orderId: 'ord_1', orderNumber: '1001' }]);
    const worker = new ShipmentCreateWorker(queue, shipments);

    await worker.drainOnce();

    expect(shipments.cancelForOrder).toHaveBeenCalledWith('m1', {
      orderId: 'ord_1',
      orderNumber: '1001',
    });
  });

  it('recreate op → recreateForOrder (orders/edited chain)', async () => {
    const shipments = fakeShipments();
    const queue = fakeQueue([{ op: 'recreate', merchantId: 'm1', orderId: 'ord_1' }]);
    const worker = new ShipmentCreateWorker(queue, shipments);

    await worker.drainOnce();

    expect(shipments.recreateForOrder).toHaveBeenCalled();
  });

  it('worker.paid.retriesOn5xx — does NOT ack when the op throws (redrive → DLQ)', async () => {
    const shipments = fakeShipments({
      createForOrder: vi.fn(async () => {
        throw new Error('delhivery responded 502');
      }),
    });
    const queue = fakeQueue([{ op: 'create', merchantId: 'm1', orderId: 'ord_1' }]);
    const worker = new ShipmentCreateWorker(queue, shipments);

    await worker.drainOnce();

    expect(queue.ack).not.toHaveBeenCalled();
  });

  it('one bad message never blocks the rest of the batch', async () => {
    const shipments = fakeShipments({
      createForOrder: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ awb: 'AWB2' }),
    });
    const queue = fakeQueue([
      { op: 'create', merchantId: 'm1', orderId: 'ord_1' },
      { op: 'create', merchantId: 'm1', orderId: 'ord_2' },
    ]);
    const worker = new ShipmentCreateWorker(queue, shipments);

    await worker.drainOnce();

    expect(queue.ack).toHaveBeenCalledTimes(1);
    expect(queue.ack).toHaveBeenCalledWith(DELHIVERY_QUEUE_NAMES.shipments, ['rh-1']);
  });
});
