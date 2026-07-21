import { Injectable, Logger } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpTransformerService } from '../transformer/transformer.service';
import { RpOrderSyncService } from '../orders/order-sync.service';

@Injectable()
export class RpProductsService {
  private readonly logger = new Logger(`RP:${RpProductsService.name}`);

  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
    private readonly orderSync: RpOrderSyncService,
  ) {}

  async getProduct(merchantId: string, domain: string, productId: string): Promise<unknown> {
    // OS product IDs > MAX_SAFE_INTEGER get hashed by normalize-order:
    // "17720223476919127" → 1107513967307445 (stored in RP as product_id).
    // When RP sends back the hashed id, we try to resolve it to the real OS id.
    // If that fails (no MongoDB), we still try OS Item Service with the hashed id,
    // which will 404 — but that's expected and RP handles it gracefully.
    
    let resolvedId = productId;
    const fromMongo = await this.resolveOsProductId(domain, productId);
    if (fromMongo) {
      resolvedId = fromMongo;
      this.logger.debug({ productId, resolvedId, domain }, 'Resolved hashed product ID via MongoDB');
    } else {
      this.logger.warn(
        { productId, domain },
        'Could not resolve hashed product ID to OS ID. Attempting lookup with hashed ID. RP_MONGO_URL may not be configured.',
      );
    }

    const raw = await this.ratioClient.getProduct(merchantId, domain, resolvedId) as Record<string, unknown>;
    const product = (raw?.product ?? raw?.data ?? raw) as Record<string, unknown>;
    const shaped = this.transformer.shopifyProduct(product);

    // If OS returned a real product, restore the hashed ID in the response
    // so RP's product cache stores and matches by the hashed id consistently.
    if (shaped && typeof shaped === 'object' && resolvedId !== productId) {
      (shaped as Record<string, unknown>).id = Number(productId) || productId;
    }

    return { product: shaped };
  }

  /**
   * Look up the original OS product ID from RP's MongoDB orders collection.
   * normalize-order stores os_product_id on each line item alongside the hashed product_id.
   * Returns null if not found or if MongoDB is not configured.
   */
  private async resolveOsProductId(domain: string, hashedProductId: string): Promise<string | null> {
    try {
      const db = await this.orderSync.getDb();
      if (!db) {
        return null;
      }
      const order = await db.collection('orders').findOne(
        {
          store: domain,
          'line_items.product_id': Number(hashedProductId) || hashedProductId,
          'line_items.os_product_id': { $exists: true, $ne: null },
        },
        { projection: { 'line_items.$': 1 } },
      );
      const li = order?.line_items?.[0];
      const resolved = li?.os_product_id ? String(li.os_product_id) : null;
      if (resolved) {
        this.logger.debug({ hashedProductId, resolved }, 'Found os_product_id in MongoDB');
      }
      return resolved;
    } catch (err) {
      this.logger.error(
        { err, domain, hashedProductId },
        'Error querying MongoDB for os_product_id',
      );
      return null;
    }
  }
}
