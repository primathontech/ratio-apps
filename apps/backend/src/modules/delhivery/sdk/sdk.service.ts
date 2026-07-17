import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryConfigService } from '../config/config.service';

type Rec = Record<string, unknown>;

/**
 * Pull the human-readable message Delhivery returns so callers can surface the
 * carrier's OWN wording (not a hardcoded guess). Success carries it in
 * `data.message` ("A new client warehouse has been created"); failures carry the
 * specific reason in the `error` array (e.g. "...already exists...") — prefer that
 * over the generic top-level `message` ("some error while creating/updating").
 */
function carrierMessage(json: Rec, success: boolean): string {
  if (success) {
    const dm = (json.data as Rec | undefined)?.message;
    return typeof dm === 'string' ? dm : '';
  }
  if (Array.isArray(json.error)) {
    return json.error.filter((s): s is string => typeof s === 'string').join('; ');
  }
  if (typeof json.error === 'string' && json.error) return json.error;
  return typeof json.message === 'string' ? json.message : '';
}

/** Upstream Delhivery error — carries the HTTP status so callers can branch. */
export class DelhiveryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DelhiveryApiError';
  }
}

/** One normalized tracking scan from the Delhivery tracking API. */
export interface DelhiveryScan {
  /** e.g. `UD` / `DL` / `RT` / `CN`. */
  statusType: string;
  /** e.g. `Manifested`, `In Transit`, `Dispatched`, `Delivered`. */
  status: string;
  location: string | null;
  /** ISO timestamp string when Delhivery supplies one. */
  timestamp: string | null;
}

/** Raw pincode serviceability facts as Delhivery reports them. */
export interface DelhiveryServiceabilityRaw {
  serviceable: boolean;
  codAvailable: boolean;
  prepaidAvailable: boolean;
}

/** The manifestation payload the ShipmentService assembles. */
export interface CreateShipmentArgs {
  orderNumber: string;
  paymentMode: 'COD' | 'Prepaid';
  codAmount: number;
  totalAmount: number;
  weightGrams: number;
  dims: { l: number; b: number; h: number };
  hsnCode: string | null;
  productsDesc: string;
  quantity: number;
  consignee: {
    name: string;
    address: string;
    pincode: string;
    city: string;
    state: string;
    country: string;
    phone: string;
  };
}

/**
 * Delhivery Express B2C carrier adapter — the vendor integration.
 *
 * A typed client over Delhivery's REST API (`Authorization: Token <apiToken>`,
 * base host from `DELHIVERY_API_BASE`): pincode serviceability, manifestation
 * (shipment creation → waybill), bulk waybill fetch, packing-slip/label PDF,
 * pickup/manifest requests, tracking, and cancellation.
 *
 * Per-merchant credentials resolve through {@link DelhiveryConfigService}
 * (token decrypted in memory only). The token is only ever placed on the
 * outbound Authorization header — it is NEVER logged and never leaves the
 * backend (labels are proxied, not linked with credentials).
 *
 * `fetchImpl` is an overridable seam so unit tests inject a fake network.
 */
@Injectable()
export class DelhiverySdkService {
  private readonly logger = new Logger(DelhiverySdkService.name);
  /** Test seam — override with a fake in unit tests. */
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);

  constructor(private readonly configs: DelhiveryConfigService) {}

  private get base(): string {
    return (process.env.DELHIVERY_API_BASE ?? 'https://staging-express.delhivery.com').replace(
      /\/$/,
      '',
    );
  }

  private async token(merchantId: string): Promise<string> {
    const config = await this.configs.getByMerchantId(merchantId);
    if (!config.apiToken) {
      throw new DelhiveryApiError('merchant has no Delhivery API token configured', 401);
    }
    return config.apiToken;
  }

  /**
   * Core request helper. Throws {@link DelhiveryApiError} on non-2xx. Never
   * logs the token; error logs carry `{ path, status }` only (Delhivery error
   * bodies may echo request fields).
   */
  private async request(
    token: string,
    path: string,
    init: { method?: string; body?: string; contentType?: string; timeoutMs?: number } = {},
  ): Promise<Response> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Token ${token}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': init.contentType ?? 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
      // Bound slow endpoints (the warehouse `edit` API has a ~61s P99) so a
      // request never hangs the caller; an abort surfaces as a thrown error.
      ...(init.timeoutMs ? { signal: AbortSignal.timeout(init.timeoutMs) } : {}),
    });
    if (!res.ok) {
      this.logger.error({ msg: 'delhivery upstream error', path: path.split('?')[0], status: res.status });
      throw new DelhiveryApiError(`delhivery responded ${res.status}`, res.status);
    }
    return res;
  }

  /**
   * Cheap auth check for the admin "Test connection" button — a pincode
   * lookup succeeds iff the token is valid. Non-2xx is a clean `ok:false`
   * (401 = bad token); network failures surface as status 0.
   */
  async testConnection(merchantId: string): Promise<{ ok: boolean; status: number }> {
    try {
      const token = await this.token(merchantId);
      await this.request(token, '/c/api/pin-codes/json/?filter_codes=110001');
      return { ok: true, status: 200 };
    } catch (err) {
      if (err instanceof DelhiveryApiError) return { ok: false, status: err.status };
      this.logger.warn({ msg: 'delhivery test connection failed (network)', err: `${err}` });
      return { ok: false, status: 0 };
    }
  }

  /**
   * Best-effort warehouse (pickup location) registration on config save
   * (PRD §5 warehouse-registration flow). Sends the full pickup address —
   * Delhivery's Warehouse Creation API requires `name` + `phone` + `pin`; the
   * warehouse doubles as the RTO destination, so `return_address`/`return_pin`
   * reuse the pickup address. Delhivery rejects duplicate names, so an
   * already-registered warehouse is fine — this never throws.
   */
  async registerWarehouse(
    merchantId: string,
  ): Promise<{ ok: boolean; status: 'created' | 'exists' | 'failed'; message: string }> {
    try {
      const config = await this.configs.getByMerchantId(merchantId);
      // Need at least name + pin + phone to register a usable warehouse.
      if (!config.apiToken || !config.pickupLocationName || !config.pickupPincode) {
        return { ok: false, status: 'failed', message: 'Pickup location name, pincode and phone are required.' };
      }
      const res = await this.request(config.apiToken, '/api/backend/clientwarehouse/create/', {
        method: 'POST',
        body: JSON.stringify({
          name: config.pickupLocationName,
          phone: config.pickupPhone,
          pin: config.pickupPincode,
          address: config.pickupAddress,
          city: config.pickupCity,
          country: 'India',
          return_address: config.pickupAddress,
          return_pin: config.pickupPincode,
          return_city: config.pickupCity,
        }),
      });
      // Delhivery returns HTTP 200 even on failure — the body's `success` flag is
      // authoritative. A duplicate name is HTTP 200 + success:false + error_code
      // 2000 ("...already exists...") — that means the warehouse is present, which
      // is a fine outcome, so report it as `exists` (not a failure). The message
      // shown to the merchant is Delhivery's own, never hardcoded.
      const json = (await res.json().catch(() => ({}))) as Rec;
      if (json.success === true) {
        return { ok: true, status: 'created', message: carrierMessage(json, true) };
      }
      const message = carrierMessage(json, false);
      const codes = Array.isArray(json.error_code) ? json.error_code : [];
      if (codes.includes(2000) || /already exists/i.test(message)) {
        return { ok: true, status: 'exists', message };
      }
      this.logger.warn({ msg: 'delhivery warehouse registration rejected', merchantId, codes });
      return { ok: false, status: 'failed', message };
    } catch (err) {
      // Non-2xx (bad token, upstream 5xx) — request() threw.
      this.logger.warn({ msg: 'delhivery warehouse registration error', merchantId, err: `${err}` });
      return { ok: false, status: 'failed', message: 'Could not reach Delhivery to register the warehouse.' };
    }
  }

  /**
   * Update an EXISTING warehouse's editable fields (pincode/address/phone) via
   * Delhivery's Warehouse `edit` API. The warehouse `name` is the immutable key
   * and cannot change — a name change is a new warehouse (handled by create).
   * Timeout-bounded because `edit` has a ~61s P99.
   */
  async updateWarehouse(
    merchantId: string,
  ): Promise<{ ok: boolean; status: 'updated' | 'failed'; message: string }> {
    try {
      const config = await this.configs.getByMerchantId(merchantId);
      if (!config.apiToken || !config.pickupLocationName || !config.pickupPincode) {
        return { ok: false, status: 'failed', message: 'Pickup location name, pincode and phone are required.' };
      }
      const res = await this.request(config.apiToken, '/api/backend/clientwarehouse/edit/', {
        method: 'POST',
        // Above the endpoint's documented ~61s P99 (plus headroom) so a normal
        // slow edit isn't aborted mid-flight and mis-reported as a failure.
        timeoutMs: 70_000,
        body: JSON.stringify({
          name: config.pickupLocationName,
          pin: config.pickupPincode,
          address: config.pickupAddress,
          phone: config.pickupPhone,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Rec;
      if (json.success === true) return { ok: true, status: 'updated', message: carrierMessage(json, true) };
      const message = carrierMessage(json, false);
      this.logger.warn({ msg: 'delhivery warehouse update rejected', merchantId });
      return { ok: false, status: 'failed', message };
    } catch (err) {
      this.logger.warn({ msg: 'delhivery warehouse update error', merchantId, err: `${err}` });
      // A timeout (edit exceeded even the generous cap) is not a confirmed failure —
      // Delhivery may still apply it server-side, and the next save re-attempts it.
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      return {
        ok: false,
        status: 'failed',
        message: timedOut
          ? 'Delhivery took too long to confirm the update — it may still apply. Save again to retry.'
          : 'Could not reach Delhivery to update the warehouse.',
      };
    }
  }

  /**
   * Keep the Delhivery warehouse in sync with the merchant's saved pickup config.
   * Create first; if the name already exists, push the current pickup details via
   * `edit`. We ALWAYS edit on `exists` rather than diffing against the prior config:
   * edit is idempotent, and unconditional sync makes the flow self-healing — if an
   * edit ever fails/times out, the merchant's next save simply retries it (a config-
   * diff gate would compare the already-persisted values and never retry). Config
   * saves are infrequent and well within Delhivery's rate limit.
   */
  async syncWarehouse(
    merchantId: string,
  ): Promise<{ ok: boolean; status: 'created' | 'exists' | 'updated' | 'failed'; message: string }> {
    const created = await this.registerWarehouse(merchantId);
    if (created.status !== 'exists') return created; // 'created' or 'failed' (with its carrier message)
    // Name already registered → push the current pickup details so Delhivery stays
    // in sync with the saved config. This also replaces the raw "already exists"
    // create error with the edit's own (clean) outcome message.
    return this.updateWarehouse(merchantId);
  }

  /** Pincode serviceability. Throws on upstream failure — callers decide fail-open. */
  async checkServiceability(merchantId: string, pincode: string): Promise<DelhiveryServiceabilityRaw> {
    const token = await this.token(merchantId);
    const res = await this.request(
      token,
      `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`,
    );
    const json = (await res.json()) as Rec;
    const codes = Array.isArray(json.delivery_codes) ? (json.delivery_codes as Rec[]) : [];
    const postal = (codes[0]?.postal_code ?? null) as Rec | null;
    if (!postal) return { serviceable: false, codAvailable: false, prepaidAvailable: false };
    return {
      serviceable: true,
      codAvailable: postal.cod === 'Y',
      prepaidAvailable: postal.pre_paid === 'Y',
    };
  }

  /** One Expected-TAT lookup (days) for a mode; null on failure/absent value. */
  private async tatDays(
    token: string,
    originPin: string,
    destinationPin: string,
    mode: 'E' | 'S',
  ): Promise<number | null> {
    try {
      const res = await this.request(
        token,
        `/api/dc/expected_tat?origin_pin=${encodeURIComponent(originPin)}` +
          `&destination_pin=${encodeURIComponent(destinationPin)}&mot=${mode}`,
      );
      const json = (await res.json()) as Rec;
      const data = (json.data ?? null) as Rec | null;
      const tat = data?.tat;
      return typeof tat === 'number' && Number.isFinite(tat) && tat > 0 ? tat : null;
    } catch {
      // TAT is a nice-to-have on top of serviceability — never surface it as an
      // error; the caller falls back to a generic EDD estimate.
      return null;
    }
  }

  /**
   * Real per-lane delivery estimate from Delhivery's Expected TAT API
   * (`GET /api/dc/expected_tat`). Uses the merchant's pickup pincode as
   * `origin_pin`; returns an EDD band with express (`mot=E`) as the fast bound
   * and surface (`mot=S`) as the slow bound. Returns null when no pickup pincode
   * is configured or both lookups fail — callers then use a generic estimate.
   */
  async expectedTatBand(
    merchantId: string,
    destinationPin: string,
  ): Promise<{ min: number; max: number } | null> {
    const config = await this.configs.getByMerchantId(merchantId);
    if (!config.apiToken || !config.pickupPincode) return null;
    const [express, surface] = await Promise.all([
      this.tatDays(config.apiToken, config.pickupPincode, destinationPin, 'E'),
      this.tatDays(config.apiToken, config.pickupPincode, destinationPin, 'S'),
    ]);
    const days = [express, surface].filter((v): v is number => v != null);
    if (days.length === 0) return null;
    return { min: Math.min(...days), max: Math.max(...days) };
  }

  /**
   * Manifestation — create the shipment and get the waybill (AWB) back.
   * Delhivery's create API expects the classic `format=json&data=<json>` body.
   * Weight is sent in KILOGRAMS (`weightGrams / 1000`).
   */
  async createShipment(merchantId: string, args: CreateShipmentArgs): Promise<{ awb: string }> {
    const config = await this.configs.getByMerchantId(merchantId);
    if (!config.apiToken) throw new DelhiveryApiError('no Delhivery API token configured', 401);
    const payload = {
      shipments: [
        {
          order: args.orderNumber,
          payment_mode: args.paymentMode,
          cod_amount: args.paymentMode === 'COD' ? args.codAmount : 0,
          total_amount: args.totalAmount,
          name: args.consignee.name,
          add: args.consignee.address,
          pin: args.consignee.pincode,
          city: args.consignee.city,
          state: args.consignee.state,
          country: args.consignee.country,
          phone: args.consignee.phone,
          products_desc: args.productsDesc,
          hsn_code: args.hsnCode ?? '',
          quantity: args.quantity,
          // grams → kg for Delhivery's manifestation contract.
          weight: args.weightGrams / 1000,
          shipment_length: args.dims.l,
          shipment_width: args.dims.b,
          shipment_height: args.dims.h,
          seller_gst_tin: config.gstin,
        },
      ],
      pickup_location: { name: config.pickupLocationName },
    };
    const res = await this.request(config.apiToken, '/api/cmu/create.json', {
      method: 'POST',
      body: `format=json&data=${JSON.stringify(payload)}`,
    });
    const json = (await res.json()) as Rec;
    const packages = Array.isArray(json.packages) ? (json.packages as Rec[]) : [];
    const first = packages[0];
    const waybill = typeof first?.waybill === 'string' ? first.waybill : '';
    if (!waybill) {
      const remarks = first?.remarks ?? json.rmk ?? 'manifestation rejected';
      throw new DelhiveryApiError(`delhivery manifestation failed: ${JSON.stringify(remarks)}`, 422);
    }
    return { awb: waybill };
  }

  /** Pre-fetch unassigned waybills (bulk allocation). */
  async fetchWaybills(merchantId: string, count: number): Promise<string[]> {
    const token = await this.token(merchantId);
    const res = await this.request(token, `/waybill/api/bulk/json/?count=${count}`);
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) return json.map(String);
    if (typeof json === 'string') return json.split(',').filter(Boolean);
    return [];
  }

  /**
   * Label PDF for an AWB. Returns the raw bytes so the controller can proxy
   * the stream — the Delhivery credential stays server-side; the browser only
   * ever sees our authenticated `/delhivery/api/shipments/:awb/label` route.
   */
  async getLabel(merchantId: string, awb: string): Promise<{ pdf: Buffer; contentType: string }> {
    const token = await this.token(merchantId);
    const res = await this.request(
      token,
      `/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`,
    );
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/pdf')) {
      return { pdf: Buffer.from(await res.arrayBuffer()), contentType: 'application/pdf' };
    }
    // JSON envelope carrying a signed download link — follow it server-side.
    const json = (await res.json()) as Rec;
    const packages = Array.isArray(json.packages) ? (json.packages as Rec[]) : [];
    const link = packages[0]?.pdf_download_link;
    if (typeof link !== 'string' || !link) {
      throw new DelhiveryApiError('no label available for waybill', 404);
    }
    const pdfRes = await this.fetchImpl(link);
    if (!pdfRes.ok) throw new DelhiveryApiError(`label download failed ${pdfRes.status}`, 502);
    return { pdf: Buffer.from(await pdfRes.arrayBuffer()), contentType: 'application/pdf' };
  }

  /** File a pickup/manifest request for the merchant's pickup location. */
  async requestPickup(
    merchantId: string,
    args: { date: string; time?: string; count: number },
  ): Promise<{ scheduled: boolean }> {
    const config = await this.configs.getByMerchantId(merchantId);
    if (!config.apiToken) throw new DelhiveryApiError('no Delhivery API token configured', 401);
    await this.request(config.apiToken, '/fm/request/new/', {
      method: 'POST',
      body: JSON.stringify({
        pickup_location: config.pickupLocationName,
        pickup_date: args.date,
        pickup_time: args.time ?? '14:00:00',
        expected_package_count: args.count,
      }),
    });
    return { scheduled: true };
  }

  /** Tracking scans for one AWB, oldest → newest. */
  async track(merchantId: string, awb: string): Promise<DelhiveryScan[]> {
    const token = await this.token(merchantId);
    const res = await this.request(token, `/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`);
    const json = (await res.json()) as Rec;
    const shipmentData = Array.isArray(json.ShipmentData) ? (json.ShipmentData as Rec[]) : [];
    const shipment = (shipmentData[0]?.Shipment ?? null) as Rec | null;
    if (!shipment) return [];

    const toScan = (s: Rec): DelhiveryScan => ({
      statusType: typeof s.StatusType === 'string' ? s.StatusType : '',
      status: typeof s.Status === 'string' ? s.Status : (typeof s.Scan === 'string' ? s.Scan : ''),
      location:
        typeof s.StatusLocation === 'string'
          ? s.StatusLocation
          : typeof s.ScannedLocation === 'string'
            ? s.ScannedLocation
            : null,
      timestamp:
        typeof s.StatusDateTime === 'string'
          ? s.StatusDateTime
          : typeof s.ScanDateTime === 'string'
            ? s.ScanDateTime
            : null,
    });

    const scans: DelhiveryScan[] = [];
    const scanList = Array.isArray(shipment.Scans) ? (shipment.Scans as Rec[]) : [];
    for (const entry of scanList) {
      const detail = (entry.ScanDetail ?? entry) as Rec;
      scans.push(toScan(detail));
    }
    // The current Status block is the latest word — append it last.
    if (shipment.Status && typeof shipment.Status === 'object') {
      scans.push(toScan(shipment.Status as Rec));
    }
    return scans;
  }

  /** Cancel a manifested (pre-pickup) shipment. */
  async cancelShipment(merchantId: string, awb: string): Promise<void> {
    const token = await this.token(merchantId);
    await this.request(token, '/api/p/edit', {
      method: 'POST',
      body: JSON.stringify({ waybill: awb, cancellation: 'true' }),
    });
  }
}
