import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpTransformerService } from '../transformer/transformer.service';
import { RpOrderSyncService } from '../orders/order-sync.service';

@Injectable()
export class RpProductsService {
  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
    private readonly orderSync: RpOrderSyncService,
  ) {}

  async getProduct(merchantId: string, domain: string, productId: string): Promise<unknown> {
    // OS product IDs are > MAX_SAFE_INTEGER so normalize-order hashes them.
    // e.g. "17720223476919127" → 1107513967307445 (stored in RP MongoDB as product_id).
    // RP sends back the hashed id; we must resolve it to the real OS id before
    // calling OS Item Service (which only knows the original id).
    const resolvedId = await this.resolveOsProductId(domain, productId) ?? productId;

    const raw = await this.ratioClient.getProduct(merchantId, domain, resolvedId) as Record<string, unknown>;
    const product = (raw?.product ?? raw?.data ?? raw) as Record<string, unknown>;
    const shaped = this.transformer.shopifyProduct(product);

    // If OS returned a real product, ensure its id in the response is the hashed
    // value RP expects (so RP's product cache stores and matches by the same id).
    if (shaped && typeof shaped === 'object' && resolvedId !== productId) {
      (shaped as Record<string, unknown>).id = Number(productId) || productId;
    }

    return { product: shaped };
  }

  /**
   * Look up the original OS product ID from RP's MongoDB orders collection.
   * normalize-order stores os_product_id on each line item alongside the hashed product_id.
   * Returns null if not found (caller falls back to the hashed id as-is).
   */
  private async resolveOsProductId(domain: string, hashedProductId: string): Promise<string | null> {
    try {
      const db = await this.orderSync.getDb();
      if (!db) return null;
      const order = await db.collection('orders').findOne(
        {
          store: domain,
          'line_items.product_id': Number(hashedProductId) || hashedProductId,
          'line_items.os_product_id': { $exists: true, $ne: null },
        },
        { projection: { 'line_items.$': 1 } },
      );
      const li = order?.line_items?.[0];
      return li?.os_product_id ? String(li.os_product_id) : null;
    } catch {
      return null;
    }
  }
}
