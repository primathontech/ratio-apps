import { describe, expect, it, vi } from 'vitest';
import type { DelhiveryConfigService } from '../../../../src/modules/delhivery/config/config.service';
import {
  DelhiveryApiError,
  DelhiverySdkService,
} from '../../../../src/modules/delhivery/sdk/sdk.service';

const config = {
  apiToken: 'dlv-secret-token-xyz',
  pickupLocationName: 'Main Warehouse',
  pickupPincode: '122001',
  pickupPhone: '9876543210',
  pickupAddress: 'Plot 5, Industrial Area',
  pickupCity: 'Gurgaon',
  gstin: '29ABCDE1234F1Z5',
  pickupCutoff: '10:00',
  awbTrigger: 'auto' as const,
  defaultBox: { l: 10, b: 12, h: 8 },
  enabled: true,
};

function makeSdk(fetchImpl: typeof fetch, cfg = config): DelhiverySdkService {
  const configs = {
    getByMerchantId: vi.fn(async () => cfg),
  } as unknown as DelhiveryConfigService;
  const sdk = new DelhiverySdkService(configs);
  sdk.fetchImpl = fetchImpl;
  return sdk;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DelhiverySdkService (Delhivery Express B2C adapter)', () => {
  it('sends `Authorization: Token <apiToken>` on every call', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ delivery_codes: [] }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    await sdk.checkServiceability('mer_1', '560001');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/c/api/pin-codes/json/?filter_codes=560001');
    expect((init.headers as Record<string, string>).authorization).toBe('Token dlv-secret-token-xyz');
  });

  it('config.test.ok — testConnection returns ok on 200', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ delivery_codes: [] }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.testConnection('mer_1')).resolves.toEqual({ ok: true, status: 200 });
  });

  it('config.test.invalid401 — testConnection maps upstream 401 to ok:false', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'Invalid token' }, 401));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.testConnection('mer_1')).resolves.toEqual({ ok: false, status: 401 });
  });

  it('worker.paid.createsAwb — manifestation returns the waybill', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, packages: [{ status: 'Success', waybill: 'AWB123456' }] }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const res = await sdk.createShipment('mer_1', {
      orderNumber: '1001',
      paymentMode: 'Prepaid',
      codAmount: 0,
      totalAmount: 1499,
      weightGrams: 750,
      dims: { l: 10, b: 12, h: 8 },
      hsnCode: '6109',
      productsDesc: 'Tee',
      quantity: 1,
      consignee: {
        name: 'A B',
        address: '1 MG Road',
        pincode: '560001',
        city: 'Bengaluru',
        state: 'KA',
        country: 'India',
        phone: '9999999999',
      },
    });

    expect(res.awb).toBe('AWB123456');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/cmu/create.json');
    // Form-urlencoded body with the JSON URL-encoded in `data`.
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = String(init.body);
    expect(body.startsWith('format=json&data=')).toBe(true);
    const data = JSON.parse(decodeURIComponent(body.slice('format=json&data='.length))) as {
      shipments: Array<Record<string, unknown>>;
      pickup_location: { name: string };
    };
    // grams → kg on the wire.
    expect(data.shipments[0].weight).toBe(0.75);
    expect(data.shipments[0].seller_gst_tin).toBe(config.gstin);
    expect(data.pickup_location.name).toBe('Main Warehouse');
  });

  it('manifestation without a waybill throws a DelhiveryApiError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ packages: [{ status: 'Fail', remarks: ['pincode not serviceable'] }] }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(
      sdk.createShipment('mer_1', {
        orderNumber: '1001',
        paymentMode: 'COD',
        codAmount: 100,
        totalAmount: 100,
        weightGrams: 500,
        dims: { l: 1, b: 1, h: 1 },
        hsnCode: null,
        productsDesc: 'x',
        quantity: 1,
        consignee: {
          name: 'A',
          address: 'B',
          pincode: '999999',
          city: 'C',
          state: 'S',
          country: 'India',
          phone: '1',
        },
      }),
    ).rejects.toBeInstanceOf(DelhiveryApiError);
  });

  it('label.proxyStreamsPdf — direct PDF responses come back as bytes', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake');
    const fetchImpl = vi.fn(
      async () =>
        new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const { pdf, contentType } = await sdk.getLabel('mer_1', 'AWB123456');
    expect(contentType).toBe('application/pdf');
    expect(pdf.toString()).toContain('%PDF');
  });

  it('label.credsServerSide — the download link is followed server-side; the token never appears in the result', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake');
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('packing_slip')) {
        return jsonResponse({ packages: [{ pdf_download_link: 'https://cdn.example/label.pdf' }] });
      }
      return new Response(pdfBytes, { status: 200, headers: { 'content-type': 'application/pdf' } });
    });
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const { pdf } = await sdk.getLabel('mer_1', 'AWB123456');
    expect(pdf.toString()).toContain('%PDF');
    // Two server-side hops; the signed CDN fetch carries NO Delhivery token.
    const second = fetchImpl.mock.calls[1] as unknown as [string, RequestInit | undefined];
    expect(second[0]).toBe('https://cdn.example/label.pdf');
    expect(JSON.stringify(second[1] ?? {})).not.toContain('dlv-secret-token-xyz');
  });

  it('track normalizes ShipmentData scans oldest→newest with the Status block last', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        ShipmentData: [
          {
            Shipment: {
              Status: { Status: 'In Transit', StatusType: 'UD', StatusLocation: 'BLR Hub', StatusDateTime: '2026-07-01T10:00:00' },
              Scans: [
                { ScanDetail: { Scan: 'Manifested', StatusType: 'UD', ScannedLocation: 'BLR WH', ScanDateTime: '2026-06-30T09:00:00' } },
              ],
            },
          },
        ],
      }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const scans = await sdk.track('mer_1', 'AWB123456');
    expect(scans).toHaveLength(2);
    expect(scans[0]).toMatchObject({ status: 'Manifested', statusType: 'UD', location: 'BLR WH' });
    expect(scans[1]).toMatchObject({ status: 'In Transit', statusType: 'UD', location: 'BLR Hub' });
  });

  it('cancelShipment posts the cancellation edit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: true }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await sdk.cancelShipment('mer_1', 'AWB123456');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/p/edit');
    expect(JSON.parse(String(init.body))).toEqual({ waybill: 'AWB123456', cancellation: 'true' });
  });

  it('propagates upstream 5xx as DelhiveryApiError (worker leaves the message for redrive)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'oops' }, 502));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.checkServiceability('mer_1', '560001')).rejects.toMatchObject({ status: 502 });
  });

  it('registerWarehouse sends the full pickup address (name/phone/pin/address + return address)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const res = await sdk.registerWarehouse('mer_1');

    expect(res).toMatchObject({ ok: true, status: 'created' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/backend/clientwarehouse/create/');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Main Warehouse',
      phone: '9876543210',
      pin: '122001',
      address: 'Plot 5, Industrial Area',
      // warehouse doubles as the RTO destination
      return_address: 'Plot 5, Industrial Area',
      return_pin: '122001',
    });
  });

  it('registerWarehouse detects a duplicate (HTTP 200 + success:false + error_code 2000) as status:exists', async () => {
    // Verified live: a duplicate name is 200 OK with this body, NOT an HTTP error.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: false,
        error: ['Transaction Failed: client-warehouse … with name: Main Warehouse already exists CLIENT_STORES_CREATE'],
        error_code: [2000],
      }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    const res = await sdk.registerWarehouse('mer_1');
    expect(res).toMatchObject({ ok: true, status: 'exists' });
    // message is Delhivery's OWN error text, surfaced verbatim (not hardcoded).
    expect(res.message).toMatch(/already exists/i);
  });

  it('registerWarehouse reports status:failed on a real 200+success:false rejection (not a duplicate)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, error: ['ClientWarehouse pincode is not serviceable'], error_code: [999] }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    const res = await sdk.registerWarehouse('mer_1');
    expect(res).toMatchObject({ ok: false, status: 'failed' });
    // the real rejection reason comes straight from Delhivery
    expect(res.message).toMatch(/not serviceable/i);
  });

  it('registerWarehouse returns failed when no pickup pincode is configured (no call made)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch, { ...config, pickupPincode: '' });
    await expect(sdk.registerWarehouse('mer_1')).resolves.toMatchObject({ ok: false, status: 'failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('updateWarehouse edits pin/address/phone for the existing name → updated', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const res = await sdk.updateWarehouse('mer_1');

    expect(res).toMatchObject({ ok: true, status: 'updated' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/backend/clientwarehouse/edit/');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Main Warehouse',
      pin: '122001',
      address: 'Plot 5, Industrial Area',
      phone: '9876543210',
    });
  });

  it('updateWarehouse reports failed on a 200+success:false rejection', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, error: ['nope'] }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.updateWarehouse('mer_1')).resolves.toMatchObject({ ok: false, status: 'failed' });
  });

  it('updateWarehouse — a timeout is reported honestly (may still apply / retry), not a hard failure', async () => {
    const fetchImpl = vi.fn(async () => {
      // Mirror what AbortSignal.timeout(...) throws when the edit exceeds the cap.
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    });
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    const res = await sdk.updateWarehouse('mer_1');
    expect(res).toMatchObject({ ok: false, status: 'failed' });
    expect(res.message).toMatch(/may still apply|save again to retry|took too long/i);
  });

  it('syncWarehouse — new name → create succeeds → created, no edit call', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.syncWarehouse('mer_1')).resolves.toMatchObject({ ok: true, status: 'created' });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/clientwarehouse/edit/'))).toBe(false);
  });

  it('syncWarehouse — name already exists → always edits (sync) → updated', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/clientwarehouse/create/')
        ? jsonResponse({ success: false, error: ['…already exists'], error_code: [2000] })
        : jsonResponse({ success: true }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.syncWarehouse('mer_1')).resolves.toMatchObject({ ok: true, status: 'updated' });
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/clientwarehouse/edit/'))).toBe(true);
  });

  it('syncWarehouse — edit fails after an exists → surfaces the edit failure (self-heals on next save)', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/clientwarehouse/create/')
        ? jsonResponse({ success: false, error: ['…already exists'], error_code: [2000] })
        : jsonResponse({ success: false, error: ['pincode not serviceable'] }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    const res = await sdk.syncWarehouse('mer_1');
    expect(res).toMatchObject({ ok: false, status: 'failed' });
    // the surfaced reason is the EDIT's error, never the raw "already exists" create error
    expect(res.message).toMatch(/not serviceable/i);
    expect(res.message).not.toMatch(/already exists/i);
  });

  it('expectedTatBand — real EDD band from the TAT API (express=min, surface=max)', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      jsonResponse({ success: true, data: { tat: String(url).includes('mot=E') ? 3 : 5 } }),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);

    const band = await sdk.expectedTatBand('mer_1', '400001');

    expect(band).toEqual({ min: 3, max: 5 });
    // origin comes from the configured pickup pincode; both modes queried
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('/api/dc/expected_tat'))).toBe(true);
    expect(urls.some((u) => u.includes('origin_pin=122001') && u.includes('destination_pin=400001'))).toBe(true);
    expect(urls.some((u) => u.includes('mot=E'))).toBe(true);
    expect(urls.some((u) => u.includes('mot=S'))).toBe(true);
  });

  it('expectedTatBand — null when no pickup pincode configured (no call made)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { tat: 3 } }));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch, { ...config, pickupPincode: '' });
    await expect(sdk.expectedTatBand('mer_1', '400001')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('expectedTatBand — null (fall back to estimate) when the TAT call fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 500));
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.expectedTatBand('mer_1', '400001')).resolves.toBeNull();
  });

  it('expectedTatBand — one mode failing yields a degenerate band from the surviving mode', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('mot=E')
        ? jsonResponse({ success: true, data: { tat: 3 } })
        : jsonResponse({ error: 'nope' }, 500),
    );
    const sdk = makeSdk(fetchImpl as unknown as typeof fetch);
    await expect(sdk.expectedTatBand('mer_1', '400001')).resolves.toEqual({ min: 3, max: 3 });
  });
});
