import { Injectable } from '@nestjs/common';
import type { UcConfig } from './config.service';
import { UcConfigService } from './config.service';

// TRD §6: the real 6 flags (source PRD §11) — one per flow, not one per
// controller. `dispatch_status_sync` covers both `dispatch.controller.ts`
// and `status.controller.ts` (they're one flow, not two); `cancel_sync`
// covers both cancel directions (`order-cancel.controller.ts` inbound,
// `order-cancelled.handler.ts` outbound) with a single flag, per PRD's
// bidirectional model.
export type FeatureGate =
  | 'product_sync'
  | 'inventory_sync'
  | 'order_push'
  | 'dispatch_status_sync'
  | 'cancel_sync'
  | 'notifications';

const GATE_TO_CONFIG_FIELD: Record<FeatureGate, keyof UcConfig> = {
  product_sync: 'productSyncEnabled',
  inventory_sync: 'inventorySyncEnabled',
  order_push: 'orderPushEnabled',
  dispatch_status_sync: 'dispatchStatusSyncEnabled',
  cancel_sync: 'cancelSyncEnabled',
  notifications: 'notificationsEnabled',
};

const CACHE_TTL_MS = 30_000;

/**
 * Per-flow, per-merchant feature gates for the Unicommerce connector
 * (TRD §6). Backed by the merchant's `uc_configs` row — a missing row means
 * every flag is OFF (default-disabled), never on. Config is cached per
 * merchant for CACHE_TTL_MS; `invalidate()` busts the cache immediately
 * after a config write.
 */
@Injectable()
export class UcFeatureFlagsService {
  private readonly cache = new Map<string, { config: UcConfig; expiresAt: number }>();

  constructor(private readonly configService: UcConfigService) {}

  async isEnabled(gate: FeatureGate, merchantId: string): Promise<boolean> {
    const config = await this.getConfig(merchantId);
    return config[GATE_TO_CONFIG_FIELD[gate]];
  }

  invalidate(merchantId: string): void {
    this.cache.delete(merchantId);
  }

  private async getConfig(merchantId: string): Promise<UcConfig> {
    const cached = this.cache.get(merchantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.config;
    }
    const config = await this.configService.getByMerchantId(merchantId);
    this.cache.set(merchantId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
    return config;
  }
}
