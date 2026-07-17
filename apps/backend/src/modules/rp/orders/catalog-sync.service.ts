import { Injectable, Logger } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpWebhooksService } from '../webhooks/webhooks.service';

/**
 * Imports the OS item catalog into RP's Product collection on merchant registration.
 * This is the OS equivalent of RP's Shopify bulk product import — without it RP has no
 * catalog, so the customer exchange picker (productSearch, which reads RP's Mongo) is
 * empty. Each product is pushed through the existing product-create webhook path
 * (transform → RP /shopify-webhook/v1/product-create), so the shape matches webhook syncs.
 *
 * Runs fire-and-forget from registration — never blocks or fails the register response.
 */
@Injectable()
export class RpCatalogSyncService {
  private readonly logger = new Logger(RpCatalogSyncService.name);
  private static readonly PAGE_SIZE = 50;
  private static readonly MAX_PAGES = 400;

  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly webhooks: RpWebhooksService,
  ) {}

  async syncCatalog(merchantId: string): Promise<void> {
    let synced = 0;
    let failed = 0;
    try {
      for (let page = 1; page <= RpCatalogSyncService.MAX_PAGES; page++) {
        const { products, hasNext } = await this.ratioClient.listProducts(
          merchantId,
          page,
          RpCatalogSyncService.PAGE_SIZE,
        );
        if (products.length === 0) break;
        for (const product of products) {
          try {
            await this.webhooks.handleProductCreate(merchantId, product);
            synced++;
          } catch (err) {
            failed++;
            this.logger.warn({ merchantId, id: product?.id, err }, 'catalog product sync failed');
          }
        }
        if (!hasNext) break;
      }
      this.logger.log({ merchantId, synced, failed }, 'RP catalog sync complete');
    } catch (err) {
      this.logger.error({ merchantId, synced, failed, err }, 'RP catalog sync aborted');
    }
  }
}
