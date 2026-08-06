import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { RpIdMappingService } from '../id-mapping/id-mapping.service';
import { normalizeOrder } from './normalize-order';
import { fetchWithCurlLog } from '../curl-log.util';

/**
 * Syncs OS orders into RP via RP's own `/shopify-webhook/v1/order-sync` endpoint.
 * Called by the order webhook handlers so RP has order data at return time
 * without needing to fetch on demand (reduces latency + decouples from OS API).
 *
 * Deliberately goes through RP's HTTP API, not a direct database connection —
 * ratio-apps has no business reaching into another service's database directly
 * (no access control at that layer, no validation, breaks the moment RP changes
 * its own schema/indexes without knowing this exists). RP's endpoint upserts via
 * its own Mongoose model, respecting whatever hooks/validation it already has.
 */
@Injectable()
export class RpOrderSyncService {
  private readonly logger = new Logger(`RP:${RpOrderSyncService.name}`);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly idMapping: RpIdMappingService,
  ) {}

  async upsertOrder(rawOrder: Record<string, unknown>, storeDomain: string): Promise<void> {
    const normalized = normalizeOrder({ ...rawOrder, store: storeDomain });
    const numericId = normalized.id as number;

    if (!numericId) {
      this.logger.warn({ storeDomain }, 'order has no numeric id after normalization — skipping');
      return;
    }

    // Runs regardless of whether the RP sync call below succeeds: id-mapping is backed by
    // ratio-apps' own database (id-mapping module), not RP's, so it must not be gated
    // behind RP's reachability — that would defeat the point of a separate mapping table.
    await this.persistLineItemIdMappings(normalized);

    const baseUrl = this.config.get('RP_BASE_URL', { infer: true }) as string | undefined;
    const token = this.config.get('OS_RP_TOKEN', { infer: true }) as string | undefined;

    if (!baseUrl || !token) {
      this.logger.error({ id: numericId, storeDomain }, 'RP not configured — skipping order sync');
      return;
    }

    try {
      const res = await fetchWithCurlLog(`${baseUrl}/shopify-webhook/v1/order-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OS-Internal-Token': token,
          'X-OS-Store': storeDomain,
        },
        body: JSON.stringify({ ...normalized, platform: 'os' }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(
          { id: numericId, storeDomain, status: res.status, body: text },
          'order sync to RP failed',
        );
        return;
      }
      this.logger.log({ id: numericId, storeDomain }, 'order synced to RP');
    } catch (err) {
      this.logger.error({ err, id: numericId, storeDomain }, 'order sync to RP threw');
    }
  }

  /** See RpOrdersService.persistLineItemIdMappings — same purpose, webhook-driven path. */
  private async persistLineItemIdMappings(order: Record<string, unknown>): Promise<void> {
    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    await Promise.all(
      lineItems.flatMap((li) => {
        const item = li as Record<string, unknown>;
        const writes: Promise<unknown>[] = [];
        if (item.os_product_id != null) {
          writes.push(this.idMapping.hashAndPersist('product', String(item.os_product_id)));
        }
        if (item.os_variant_id != null) {
          writes.push(this.idMapping.hashAndPersist('variant', String(item.os_variant_id)));
        }
        return writes;
      }),
    );
  }
}
