import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { RpMerchantsService } from '../merchants/merchants.service';
import { RpTransformerService } from '../transformer/transformer.service';
import { RpOrderSyncService } from '../orders/order-sync.service';
import { RpIdMappingService } from '../id-mapping/id-mapping.service';

type Rec = Record<string, unknown>;

@Injectable()
export class RpWebhooksService {
  private readonly logger = new Logger(`RP:${RpWebhooksService.name}`);

  constructor(
    private readonly merchants: RpMerchantsService,
    private readonly transformer: RpTransformerService,
    private readonly config: ConfigService<Env, true>,
    private readonly orderSync: RpOrderSyncService,
    private readonly idMapping: RpIdMappingService,
  ) {}

  async handleProductCreate(merchantId: string, body: Rec): Promise<void> {
    await this.forward('product-create', merchantId, body);
  }

  async handleProductUpdate(merchantId: string, body: Rec): Promise<void> {
    await this.forward('product-update', merchantId, body);
  }

  /**
   * Handles all OS order service order events (create / update / fulfilled / cancelled).
   * All topics upsert the latest order state — no topic-specific branching.
   */
  async handleOrderEvent(merchantId: string, orderPayload: Rec, topic: string): Promise<void> {
    if (!merchantId) {
      this.logger.warn({ topic }, 'order event missing merchant id — dropping');
      return;
    }
    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) {
      this.logger.warn({ merchantId, topic }, 'order event: merchant not found — dropping');
      return;
    }
    this.logger.log({ merchantId, domain: merchant.domain, topic }, 'order event received');
    await this.orderSync.upsertOrder(orderPayload, merchant.domain);
  }

  /**
   * Handles the OS `app/uninstalled` event — the adapter's equivalent of RP's own
   * `StoreDetail.active = false` uninstall webhook. Deactivates the merchant so
   * `RpRequestGuard` (via `RpMerchantsService.findByDomain`) closes the portal gate.
   */
  async handleAppUninstalled(merchantId: string): Promise<void> {
    if (!merchantId) {
      this.logger.warn('app uninstalled event missing merchant id — dropping');
      return;
    }
    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) {
      this.logger.warn({ merchantId }, 'app uninstalled event: merchant not found — dropping');
      return;
    }
    await this.merchants.deactivate(merchantId);
    this.logger.log({ merchantId, domain: merchant.domain }, 'app uninstalled — merchant deactivated');

    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string | undefined;
    const token = this.config.get('OS_RP_TOKEN', { infer: true }) as string | undefined;

    if (!baseUrl || !token) {
      this.logger.error({ merchantId }, 'RP not configured — skipping uninstall relay');
      return;
    }

    try {
      const res = await fetch(`${baseUrl}/shopify-webhook/v1/os-uninstall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Internal-Token': token,
        },
        body: JSON.stringify({ merchant_id: merchant.domain }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(
          { merchantId, domain: merchant.domain, status: res.status, body: text },
          'RP uninstall relay failed',
        );
      }
    } catch (err) {
      this.logger.error({ merchantId, domain: merchant.domain, err }, 'RP uninstall relay threw');
    }
  }

  private async forward(topic: string, merchantId: string, body: Rec): Promise<void> {
    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string | undefined;
    const token = this.config.get('OS_RP_TOKEN', { infer: true }) as string | undefined;

    if (!baseUrl || !token) {
      this.logger.error({ topic, merchantId }, 'RP not configured — skipping webhook forward');
      return;
    }

    if (!merchantId) {
      this.logger.warn({ topic }, 'missing merchant id — dropping webhook forward');
      return;
    }

    const merchant = await this.merchants.findByMerchantId(merchantId);
    if (!merchant) {
      this.logger.warn({ merchantId, topic }, 'merchant not found — dropping webhook');
      return;
    }

    // This is one of the origin points where a product's hashed id is first minted and
    // shown to RP (independent of any order) — persist the reverse mapping now so a later
    // products.controller lookup for this same product can resolve it back to the real OS id.
    const realProductId = body.id != null ? String(body.id) : null;
    if (realProductId) await this.idMapping.hashAndPersist('product', realProductId);
    const variants = Array.isArray(body.variants) ? (body.variants as Rec[]) : [];
    await Promise.all(
      variants
        .filter((v) => v.id != null)
        .map((v) => this.idMapping.hashAndPersist('variant', String(v.id))),
    );

    const shopifyPayload = this.transformer.shopifyProduct(body);

    try {
      const res = await fetch(`${baseUrl}/shopify-webhook/v1/${topic}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Internal-Token': token,
          'X-OS-Store': merchant.domain,
        },
        body: JSON.stringify(shopifyPayload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(
          { merchantId, domain: merchant.domain, topic, status: res.status, body: text },
          'RP webhook forward failed',
        );
      }
    } catch (err) {
      this.logger.error({ merchantId, domain: merchant.domain, topic, err }, 'RP webhook forward threw');
    }
  }
}
