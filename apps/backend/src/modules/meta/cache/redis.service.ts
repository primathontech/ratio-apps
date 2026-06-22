import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis (ioredis) wrapper for the Meta module — config cache, per-merchant
 * rate-limit counters, and event idempotency keys.
 *
 * NEVER a source of truth: every method degrades gracefully when Redis is
 * unavailable (returns null / treats as not-limited / not-seen) so a Redis
 * outage slows the system but never breaks it. Enabled only when REDIS_URL is
 * set; otherwise all ops are no-ops and callers fall back to the DB.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly _client: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this._client = null;
      this.logger.warn('REDIS_URL not set — cache disabled, falling back to DB');
      return;
    }
    this._client = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    this._client.on('error', (err) => this.logger.warn({ msg: 'redis error', err: err.message }));
  }

  get enabled(): boolean {
    return this._client !== null;
  }

  /** Read-only accessor for the underlying ioredis client. Used by CapiRateLimiter. */
  get client(): Redis | null {
    return this._client;
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this._client) return null;
    try {
      const raw = await this._client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this._client) return;
    try {
      await this._client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* degrade silently */
    }
  }

  async del(key: string): Promise<void> {
    if (!this._client) return;
    try {
      await this._client.del(key);
    } catch {
      /* degrade silently */
    }
  }

  /**
   * Fixed-window rate limit. Returns true if ALLOWED. Fails OPEN (allow) when
   * Redis is down — availability over strictness for a best-effort limiter.
   */
  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this._client) return true;
    try {
      const n = await this._client.incr(key);
      if (n === 1) await this._client.expire(key, windowSeconds);
      return n <= limit;
    } catch {
      return true;
    }
  }

  /** Idempotency: returns true the FIRST time a key is seen within the TTL. */
  async firstSeen(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this._client) return true; // can't dedupe without Redis → process it
    try {
      const res = await this._client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      return true;
    }
  }

  onModuleDestroy(): void {
    this._client?.disconnect();
  }
}
