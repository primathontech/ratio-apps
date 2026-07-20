import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { describe, expect, it, vi } from 'vitest';
import type { PickupCron } from '../../../../src/modules/delhivery/pickup/pickup.cron';
import type { DelhiverySdkService } from '../../../../src/modules/delhivery/sdk/sdk.service';
import type {
  DelhiveryShipmentService,
  PendingOrder,
} from '../../../../src/modules/delhivery/shipments/shipment.service';
import { DelhiveryShipmentsController } from '../../../../src/modules/delhivery/shipments/shipments.controller';

const merchant = { id: 'mer_1', isActive: true } as unknown as Merchant;

const pendingOrder: PendingOrder = {
  orderId: 'ord_2',
  orderNumber: '2002',
  customerName: 'Asha K',
  amountRupees: 1499,
  city: 'Bengaluru',
  createdAt: '2026-07-02T00:00:00.000Z',
};

const pendingPage = { items: [pendingOrder], page: 2, hasNext: true, hasPrev: true };

function makeController() {
  const shipments = {
    listPendingOrders: vi.fn(async () => pendingPage),
    findByAwb: vi.fn(),
    createForOrder: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
  } as unknown as DelhiveryShipmentService;
  const sdk = {} as unknown as DelhiverySdkService;
  const pickup = {} as unknown as PickupCron;
  return { controller: new DelhiveryShipmentsController(shipments, sdk, pickup), shipments };
}

describe('GET /delhivery/api/shipments/pending', () => {
  it('returns the { items, page, hasNext, hasPrev } page and forwards ?page', async () => {
    const { controller, shipments } = makeController();
    await expect(controller.pending(merchant, { page: 2 })).resolves.toEqual(pendingPage);
    expect(shipments.listPendingOrders).toHaveBeenCalledWith('mer_1', 2);
  });

  it('defaults to no page when the query omits it', async () => {
    const { controller, shipments } = makeController();
    await expect(controller.pending(merchant, {})).resolves.toEqual(pendingPage);
    expect(shipments.listPendingOrders).toHaveBeenCalledWith('mer_1', undefined);
  });
});
