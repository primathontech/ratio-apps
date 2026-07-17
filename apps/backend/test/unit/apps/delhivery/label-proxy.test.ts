import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PickupCron } from '../../../../src/modules/delhivery/pickup/pickup.cron';
import type { DelhiverySdkService } from '../../../../src/modules/delhivery/sdk/sdk.service';
import type { DelhiveryShipmentService } from '../../../../src/modules/delhivery/shipments/shipment.service';
import { DelhiveryShipmentsController } from '../../../../src/modules/delhivery/shipments/shipments.controller';

const merchant = { id: 'mer_1', isActive: true } as unknown as Merchant;
const pdfBytes = Buffer.from('%PDF-1.4 fake-label');

function fakeReply() {
  const headers: Record<string, string> = {};
  const sent: { payload?: unknown } = {};
  const reply = {
    header: (k: string, v: string) => {
      headers[k] = v;
      return reply;
    },
    send: (payload: unknown) => {
      sent.payload = payload;
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, headers, sent };
}

function makeController(opts: { shipment?: unknown } = {}) {
  const shipments = {
    findByAwb: vi.fn(async () => ('shipment' in opts ? opts.shipment : { id: 'shp_1', awb: 'AWB123456' })),
    createForOrder: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
  } as unknown as DelhiveryShipmentService;
  const sdk = {
    getLabel: vi.fn(async () => ({ pdf: pdfBytes, contentType: 'application/pdf' })),
  } as unknown as DelhiverySdkService;
  const pickup = { requestNow: vi.fn(async () => ({ scheduled: true, count: 3 })) } as unknown as PickupCron;
  return { controller: new DelhiveryShipmentsController(shipments, sdk, pickup), shipments, sdk, pickup };
}

describe('label proxy (GET /delhivery/api/shipments/:awb/label)', () => {
  it('label.proxyStreamsPdf — streams the PDF bytes with the pdf content type', async () => {
    const { controller, sdk } = makeController();
    const { reply, headers, sent } = fakeReply();

    await controller.label(merchant, 'AWB123456', reply);

    expect(sdk.getLabel).toHaveBeenCalledWith('mer_1', 'AWB123456');
    expect(headers['content-type']).toBe('application/pdf');
    expect(headers['content-disposition']).toContain('AWB123456');
    expect(Buffer.isBuffer(sent.payload)).toBe(true);
    expect((sent.payload as Buffer).toString()).toContain('%PDF');
  });

  it('label.credsServerSide — the response carries no Delhivery credential material', async () => {
    const { controller } = makeController();
    const { reply, headers, sent } = fakeReply();

    await controller.label(merchant, 'AWB123456', reply);

    const everything = JSON.stringify(headers) + String(sent.payload);
    expect(everything).not.toMatch(/token/i);
    expect(everything).not.toMatch(/authorization/i);
  });

  it('rejects an AWB the merchant does not own (404 before any upstream call)', async () => {
    const { controller, sdk } = makeController({ shipment: undefined });
    const { reply } = fakeReply();

    await expect(controller.label(merchant, 'AWB999999', reply)).rejects.toMatchObject({
      status: 404,
    });
    expect(sdk.getLabel).not.toHaveBeenCalled();
  });

  it('rejects a malformed AWB outright', async () => {
    const { controller, sdk } = makeController();
    const { reply } = fakeReply();
    await expect(controller.label(merchant, '../etc/passwd', reply)).rejects.toMatchObject({
      status: 400,
    });
    expect(sdk.getLabel).not.toHaveBeenCalled();
  });

  it('pickup.manualRequest — POST /pickup delegates to the pickup service', async () => {
    const { controller, pickup } = makeController();
    await expect(controller.requestPickup(merchant, {})).resolves.toEqual({
      scheduled: true,
      count: 3,
    });
    expect(pickup.requestNow).toHaveBeenCalledWith('mer_1', undefined);
  });
});
