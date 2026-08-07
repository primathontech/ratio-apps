import { Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import { ClevertapCatalogSyncService } from './catalog-sync.service';

const DEFAULT_DEBOUNCE_MS = 30_000;

@Injectable()
export class ClevertapCatalogDirtyScheduler implements OnModuleDestroy {
  private readonly logger = new Logger(ClevertapCatalogDirtyScheduler.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly sync: ClevertapCatalogSyncService,
    @Optional() private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  markDirty(merchantId: string): void {
    try {
      const existing = this.timers.get(merchantId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.timers.delete(merchantId);
        void this.sync.syncMerchant(merchantId).catch((err) => {
          this.logger.error({
            msg: 'catalog full-sync failed',
            merchantId,
            reason: err instanceof Error ? err.name : 'sync_error',
          });
        });
      }, this.debounceMs);
      this.timers.set(merchantId, timer);
    } catch (err) {
      this.logger.error({
        msg: 'failed to schedule catalog re-sync',
        merchantId,
        reason: err instanceof Error ? err.name : 'schedule_error',
      });
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
