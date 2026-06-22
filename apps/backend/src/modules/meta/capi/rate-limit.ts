import { Injectable } from '@nestjs/common';
import { RedisService } from '../cache/redis.service';

const PER_MINUTE_DEFAULT = Number(process.env.META_CAPI_DATASET_RPM ?? 100_000);

/**
 * Per-merchant token bucket + breaker (v1; per-dataset is a deferred refinement
 * that would require resolving each merchant's pixel/dataset ids).
 */
@Injectable()
export class CapiRateLimiter {
  constructor(
    private readonly redis: RedisService,
    private readonly perMinute = PER_MINUTE_DEFAULT,
  ) {}

  /** Reserve n tokens for this merchant's current minute window. Degrades OPEN. */
  async take(merchantId: string, n: number): Promise<boolean> {
    if (!this.redis.enabled || !this.redis.client) return true;
    const key = `rl:capi:m:${merchantId}:${Math.floor(Date.now() / 60_000)}`;
    try {
      const total = await this.redis.client.incrby(key, n);
      await this.redis.client.expire(key, 120);
      return total <= this.perMinute;
    } catch {
      return true; // never block dispatch on a cache failure
    }
  }

  async tripped(merchantId: string): Promise<boolean> {
    if (!this.redis.enabled || !this.redis.client) return false;
    try { return (await this.redis.client.get(`cb:capi:m:${merchantId}`)) !== null; } catch { return false; }
  }

  async trip(merchantId: string, ms: number): Promise<void> {
    if (!this.redis.enabled || !this.redis.client) return;
    try {
      await this.redis.client.set(`cb:capi:m:${merchantId}`, '1', 'PX', ms);
    } catch { /* degrade */ }
  }
}
