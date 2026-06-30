import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Generic Redis (ioredis) wrapper — config cache, rate-limit counters, event
 * idempotency keys. Vendor-agnostic core infra shared across modules.
 *
 * NEVER a source of truth: every method degrades gracefully when Redis is
 * unavailable (returns null / treats as not-limited / not-seen) so a Redis
 * outage slows the system but never breaks it. Enabled only when REDIS_URL is
 * set; otherwise all ops are no-ops and callers fall back to the DB.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.client = null;
      this.logger.warn('REDIS_URL not set — cache disabled, falling back to DB');
      return;
    }
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    this.client.on('error', (err) => this.logger.warn({ msg: 'redis error', err: err.message }));
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* degrade silently */
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch {
      /* degrade silently */
    }
  }

  /**
   * Fixed-window rate limit. Returns true if ALLOWED. Fails OPEN (allow) when
   * Redis is down — availability over strictness for a best-effort limiter.
   */
  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this.client) return true;
    try {
      const n = await this.client.incr(key);
      if (n === 1) await this.client.expire(key, windowSeconds);
      return n <= limit;
    } catch {
      return true;
    }
  }

  /** Idempotency: returns true the FIRST time a key is seen within the TTL. */
  async firstSeen(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return true; // can't dedupe without Redis → process it
    try {
      const res = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      return true;
    }
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }
}
