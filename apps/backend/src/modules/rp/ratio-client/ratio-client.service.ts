import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioClient } from '../../../core/ratio-client/ratio.client';
import { RP_RATIO_CLIENT } from '../tokens';

const anySchema = z.unknown();

@Injectable()
export class RpRatioClientService {
  private readonly logger = new Logger(`RP:${RpRatioClientService.name}`);

  constructor(@Inject(RP_RATIO_CLIENT) private readonly ratio: RatioClient) {}

  // ── Orders (Ratio App Ecosystem API) ─────────────────────────────────────
  // Was direct OS Order Service calls (gk-merchant-id header, OS_ORDER_BASE_URL) —
  // moved onto Ratio's own /api/v1/orders (OAuth bearer), the same API meta/other
  // ecosystem apps already use for get-products/orders, matching the refunds/
  // discounts/customers pattern below. No adapter should call OS's order/item
  // services directly — everything goes through Ratio.

  async getOrders(accessToken: string, params: Record<string, string>): Promise<unknown> {
    // GoKwik uses `search` param for order name/number lookup; map Shopify `name` → `search`
    const mapped: Record<string, string> = { ...params };
    if (mapped.name) {
      mapped.search = mapped.name;
      delete mapped.name;
    }
    const qs = new URLSearchParams(mapped).toString();
    return this.ratio.request(`/api/v1/orders${qs ? `?${qs}` : ''}`, anySchema, { accessToken });
  }

  async getOrder(accessToken: string, orderId: string): Promise<unknown> {
    // If a real OS order id (ordr_…) is passed, fetch it directly — the storefront/RP
    // sends this when deep-linking a specific order. Otherwise the value is a
    // Shopify-style order_number (e.g. 2484): search by it to avoid lossy ID hashing.
    if (/^ordr_/i.test(orderId)) {
      const data = (await this.ratio.request(`/api/v1/orders/${encodeURIComponent(orderId)}`, anySchema, {
        accessToken,
      })) as Record<string, unknown>;
      const order = (data?.order ?? null) as Record<string, unknown> | null;
      return { order };
    }

    const data = (await this.ratio.request(`/api/v1/orders?search=${encodeURIComponent(orderId)}`, anySchema, {
      accessToken,
    })) as Record<string, unknown>;
    const orders = (data?.orders ?? []) as Record<string, unknown>[];
    const match = orders.find((o) => String(o.order_number) === String(orderId)) ?? orders[0];
    return { order: match };
  }

  /**
   * Patch an order via Ratio. RP sends a Shopify-shaped body (`{ order: { tags } }`) to
   * mark an order returned/exchanged when the "Sync returns status" setting is on — RP
   * does NOT send `fulfillment_status` itself; this adapter derives it from the tags
   * being set (see deriveFulfillmentStatusFromTags) before forwarding to Ratio's PATCH.
   */
  async patchOrder(accessToken: string, merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    // RP dispatches to this adapter fire-and-forget (no await, no retry on its side) —
    // the Shopify-side path has SQS+Lambda redelivery for this, but here a single failed
    // HTTP call (network blip, timeout, transient 5xx) would otherwise be lost forever.
    // Retry the outbound PATCH a few times locally with a short backoff; the producer
    // stays fire-and-forget. 4xx is NOT retried (Ratio rejects the same payload every
    // time) — see isRetryableRatioError.
    const MAX_PATCH_ATTEMPTS = 3;
    const PATCH_RETRY_DELAY_MS = 250;
    // RP sends back whatever id it was shown (often the order_number, e.g. "500"), not
    // necessarily OS's real "ordr_..." id — same resolution createRefund/calculateRefund
    // already do. Without it, this 404s on the literal order_number string.
    const osId = await this.resolveOsOrderId(accessToken, orderId);
    const order = { ...((body as Record<string, unknown>)?.order ?? body) as Record<string, unknown> };
    // Derive fulfillment_status from the tags being set (checked before the array→string
    // normalization below, so array membership is exact) unless the caller already
    // provided one explicitly — don't override an explicit value.
    if (order.fulfillment_status === undefined) {
      const derived = this.deriveFulfillmentStatusFromTags(order.tags);
      if (derived) order.fulfillment_status = derived;
    }
    // RP's markOsOrderReturned.js builds tags as a JS array (buildReturnedTags dedupes into
    // [...new Set([...])]) — matching Shopify's own REST tags convention loosely, but Ratio's
    // UpdateOrderDto strictly types tags as a comma-separated string.
    if (Array.isArray(order.tags)) {
      order.tags = (order.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).join(', ');
    }
    for (let attempt = 1; attempt <= MAX_PATCH_ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, PATCH_RETRY_DELAY_MS));
      try {
        return await this.ratio.request(`/api/v1/orders/${encodeURIComponent(osId)}`, anySchema, {
          method: 'PATCH',
          accessToken,
          body: order,
        });
      } catch (err) {
        if (this.isRetryableRatioError(err) && attempt < MAX_PATCH_ATTEMPTS) {
          this.logger.warn(
            { merchantId, orderId, osId, attempt, err },
            'Ratio order patch failed — retrying',
          );
          continue;
        }
        this.logger.error(
          { merchantId, orderId, osId, attempt, err },
          'Ratio order patch failed',
        );
        throw err;
      }
    }
    // Unreachable — the loop returns on success or throws on the final attempt.
    throw new Error('Ratio order patch failed after retries');
  }

  /**
   * True only for a failure worth retrying. RatioClient (core/ratio-client/ratio.client.ts)
   * wraps EVERY non-2xx upstream response as a 502 HttpException with the real upstream
   * status nested in the response body's `details.status` — so this inspects that, not
   * err.getStatus() (which is always 502), mirroring RpRatioTokenProvider.isUpstream401.
   * Everything else that surfaces here is a network/timeout rejection (plain TypeError /
   * AbortError, no HttpException at all). So: plain errors (network/timeout) and upstream
   * 5xx are transient — retry; upstream 4xx (client error) and response-shape failures
   * (RATIO_RESPONSE_VALIDATION, no `details.status`) are permanent — fail fast.
   */
  private isRetryableRatioError(err: unknown): boolean {
    if (!(err instanceof HttpException)) return true;
    const response = err.getResponse();
    if (typeof response !== 'object' || response === null) return false;
    const details = (response as Record<string, unknown>).details;
    if (typeof details !== 'object' || details === null) return false;
    const status = (details as Record<string, unknown>).status;
    return typeof status === 'number' && status >= 500;
  }

  /**
   * RP's markOsOrderReturned.js (return_prime_public) only ever adds two possible tag
   * values via this call path — "Returned" and/or "Exchanged" (buildReturnedTags), exact
   * and case-sensitive — alongside whatever other tags the order already had. Derive
   * fulfillment_status from their presence; "exchanged" takes precedence when both are
   * present (an exchange fully supersedes what would otherwise be a plain return).
   * Returns undefined when neither is present (plain tag updates, or the separate
   * "Refunded" tag call) so unrelated PATCH bodies don't get a fulfillment_status added.
   */
  private deriveFulfillmentStatusFromTags(tags: unknown): 'returned' | 'exchanged' | undefined {
    const list: string[] = Array.isArray(tags)
      ? (tags as unknown[]).map((t) => String(t).trim())
      : typeof tags === 'string'
        ? tags.split(',').map((t) => t.trim())
        : [];
    if (list.includes('Exchanged')) return 'exchanged';
    if (list.includes('Returned')) return 'returned';
    return undefined;
  }

  // ── Discounts (Ratio App Ecosystem API) ──────────────────────────────────

  async createDiscount(accessToken: string, body: unknown): Promise<unknown> {
    return this.ratio.request('/api/v1/discounts', anySchema, {
      method: 'POST',
      accessToken,
      body,
    });
  }

  // ── Customers (Ratio App Ecosystem API) ──────────────────────────────────

  async searchCustomer(accessToken: string, email: string): Promise<unknown> {
    return this.ratio.request(`/api/v1/customers?email=${encodeURIComponent(email)}`, anySchema, {
      accessToken,
    });
  }

  async createCustomer(accessToken: string, body: unknown): Promise<unknown> {
    return this.ratio.request('/api/v1/customers', anySchema, {
      method: 'POST',
      accessToken,
      body,
    });
  }

  // ── Products (Ratio App Ecosystem API) ───────────────────────────────────
  // Was direct OS Item Service calls (OS_ITEM_BASE_URL) — moved onto Ratio's
  // /api/v1/v1/products and /api/v1/v1/variants (OAuth bearer), same reasoning
  // as orders above.

  async getProduct(accessToken: string, merchantId: string, productId: string): Promise<unknown> {
    const body = (await this.ratio.request(`/api/v1/v1/products/${encodeURIComponent(productId)}`, anySchema, {
      accessToken,
    })) as Record<string, unknown>;
    // Diagnostic for the product-id-resolution fix: an id Ratio doesn't recognize can come
    // back as an empty/placeholder product (id 0, no variants) — e.g. when products.service.ts's
    // Mongo resolution didn't find a match and fell back to the still-hashed id. Log the
    // requested id and what came back either way.
    const product = (body?.product ?? body) as Record<string, unknown> | undefined;
    const looksReal = !!product?.id && product.id !== 0 && product.id !== '0';
    this.logger.log(
      { merchantId, productId, looksReal, returnedId: product?.id },
      'Ratio product lookup',
    );
    return body;
  }

  /**
   * Page the OS item catalog via Ratio (used by the registration-time catalog
   * import into RP). Returns the page's products plus whether more pages remain.
   */
  async listProducts(
    accessToken: string,
    merchantId: string,
    page: number,
    limit: number,
  ): Promise<{ products: Record<string, unknown>[]; hasNext: boolean }> {
    const data = (await this.ratio.request(`/api/v1/v1/products?page=${page}&limit=${limit}`, anySchema, {
      accessToken,
    })) as Record<string, any>;
    const products = ((data?.products ?? []) as Record<string, unknown>[]) || [];
    const hasNext = Boolean(data?.pagination?.hasNext);
    return { products, hasNext };
  }

  /**
   * Fetch a single variant via Ratio — used to read its current inventory quantity
   * before an adjust (inventory is set as an ABSOLUTE quantity, not a delta, so the
   * caller must read-then-write).
   */
  async getVariant(accessToken: string, variantId: string): Promise<Record<string, unknown>> {
    const body = (await this.ratio.request(`/api/v1/v1/variants/${encodeURIComponent(variantId)}`, anySchema, {
      accessToken,
    })) as Record<string, unknown>;
    return (body?.data ?? body) as Record<string, unknown>;
  }

  /** Set a variant's inventory to an ABSOLUTE quantity via Ratio. */
  async setVariantInventory(accessToken: string, variantId: string, quantity: number): Promise<unknown> {
    return this.ratio.request(`/api/v1/v1/variants/${encodeURIComponent(variantId)}`, anySchema, {
      method: 'PUT',
      accessToken,
      body: { inventory: { quantity } },
    });
  }

  // ── Refunds (Ratio App Ecosystem API) ────────────────────────────────────
  // Unlike the rest of this file, refunds go through Ratio's own app API
  // (OAuth bearer, like discounts/customers below) rather than hitting OS
  // Order Service directly — resolveOsOrderId's order-number→real-id lookup
  // is unrelated plumbing and still calls OS directly for that.

  async calculateRefund(
    accessToken: string,
    merchantId: string,
    orderId: string,
    body: unknown,
  ): Promise<unknown> {
    const osId = await this.resolveOsOrderId(accessToken, orderId);
    return this.ratio.request('/api/v1/refunds/calculate', anySchema, {
      method: 'POST',
      accessToken,
      body: { ...(body as Record<string, unknown>), order_id: osId },
    });
  }

  async createRefund(
    accessToken: string,
    merchantId: string,
    orderId: string,
    body: unknown,
  ): Promise<unknown> {
    const osId = await this.resolveOsOrderId(accessToken, orderId);
    return this.ratio.request('/api/v1/refunds', anySchema, {
      method: 'POST',
      accessToken,
      headers: { 'x-idempotency-key': randomUUID() },
      body: { ...(body as Record<string, unknown>), order_id: osId },
    });
  }

  async getRefunds(accessToken: string, merchantId: string, orderId: string): Promise<unknown> {
    const osId = await this.resolveOsOrderId(accessToken, orderId);
    return this.ratio.request(`/api/v1/orders/${encodeURIComponent(osId)}/refunds`, anySchema, {
      accessToken,
    });
  }

  // Resolves an order_number (e.g. "2484") to the real OS order ID ("ordr_17835966307325080").
  // Needed because normalizeOrder uses order_number as the Shopify id to avoid lossy hashing.
  private async resolveOsOrderId(accessToken: string, orderNumber: string): Promise<string> {
    const data = (await this.ratio.request(`/api/v1/orders?search=${encodeURIComponent(orderNumber)}`, anySchema, {
      accessToken,
    })) as Record<string, unknown>;
    const orders = ((data?.orders ?? []) as Record<string, unknown>[]);
    const match = orders.find((o) => String(o.order_number) === String(orderNumber)) ?? orders[0];
    return String(match?.id ?? orderNumber);
  }

  // ── Order creation (Ratio App Ecosystem API) — exchange fulfillment ──────

  /** Create an order via Ratio (used for exchange orders). Body is already Ratio-shaped. */
  async createOrder(accessToken: string, merchantId: string, body: unknown): Promise<unknown> {
    try {
      return await this.ratio.request('/api/v1/orders', anySchema, {
        method: 'POST',
        accessToken,
        body,
      });
    } catch (err) {
      // Never let an error slip through as if it were a result (that lets normalizeOrder
      // fabricate a { id: 0 } "order", which RP would record as a successful exchange
      // that created nothing) — RatioClient already wraps non-2xx as an HttpException
      // carrying the real status/body, so just let it propagate.
      this.logger.error({ merchantId, err }, 'Ratio order creation failed');
      throw err;
    }
  }
}
