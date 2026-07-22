import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import Redis from 'ioredis';

/** PRD F14: 5 submissions per 10 minutes per (form, IP), sliding window. */
export const FORMS_SUBMIT_RATE_LIMIT = 5;
export const FORMS_SUBMIT_RATE_WINDOW_MS = 10 * 60_000;

/**
 * The sorted-set subset of the Redis API the sliding window needs — an
 * ioredis instance satisfies it structurally; tests inject a fake.
 */
export interface RateLimitRedisLike {
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** DI token for the Redis override (unset in prod → REDIS_URL / in-memory). */
export const FORMS_RATE_LIMIT_REDIS = Symbol.for('ratio-app:forms:rate-limit-redis');

/**
 * App-level business rate limit (PublicFormGuard chain step 2): 5 submissions
 * per 10 minutes per (formId, IP), sliding window over a Redis sorted set
 * (score = timestamp). Backed by ioredis when REDIS_URL is configured;
 * otherwise an in-memory window (logged once) — correct per-process, which is
 * the best available without Redis.
 *
 * Fails OPEN on Redis errors: a cache outage slows spam filtering, never
 * legitimate submissions (same stance as core RedisService).
 */
@Injectable()
export class SubmitRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(SubmitRateLimitService.name);
  private readonly redis: RateLimitRedisLike | null;
  /** Owned ioredis client (only when built from REDIS_URL) — closed on shutdown. */
  private readonly ownedClient: Redis | null = null;
  /** In-memory fallback: key → sorted submission timestamps. */
  private readonly memory = new Map<string, number[]>();

  constructor(@Optional() @Inject(FORMS_RATE_LIMIT_REDIS) redis?: RateLimitRedisLike) {
    if (redis) {
      this.redis = redis;
      return;
    }
    const url = process.env.REDIS_URL;
    if (url) {
      const client = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
        enableOfflineQueue: false,
      });
      client.on('error', (err) =>
        this.logger.warn({ msg: 'redis error (submit rate limit)', err: err.message }),
      );
      this.ownedClient = client;
      this.redis = client;
      return;
    }
    this.redis = null;
    this.logger.warn(
      'REDIS_URL not set — forms submit rate limit falling back to in-memory window',
    );
  }

  /** Returns true when the submission is ALLOWED (and records it). */
  async allow(formId: string, ip: string): Promise<boolean> {
    const key = `forms:submit:${formId}:${ip}`;
    const now = Date.now();
    if (!this.redis) {
      return this.allowInMemory(key, now);
    }
    try {
      await this.redis.zremrangebyscore(key, 0, now - FORMS_SUBMIT_RATE_WINDOW_MS);
      const count = await this.redis.zcard(key);
      if (count >= FORMS_SUBMIT_RATE_LIMIT) {
        return false;
      }
      // Random member suffix so two submissions in the same millisecond both count.
      await this.redis.zadd(key, now, `${now}:${randomBytes(4).toString('hex')}`);
      await this.redis.expire(key, Math.ceil(FORMS_SUBMIT_RATE_WINDOW_MS / 1000));
      return true;
    } catch {
      // Fail open — availability over strictness for a best-effort limiter.
      return true;
    }
  }

  private allowInMemory(key: string, now: number): boolean {
    const cutoff = now - FORMS_SUBMIT_RATE_WINDOW_MS;
    const kept = (this.memory.get(key) ?? []).filter((ts) => ts > cutoff);
    if (kept.length >= FORMS_SUBMIT_RATE_LIMIT) {
      this.memory.set(key, kept);
      return false;
    }
    kept.push(now);
    this.memory.set(key, kept);
    return true;
  }

  onModuleDestroy(): void {
    this.ownedClient?.disconnect();
  }
}
