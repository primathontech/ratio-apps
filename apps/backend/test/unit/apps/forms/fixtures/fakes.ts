import type { QueueService } from '../../../../../src/core/queue/queue.service';
import type { EmailClientLike } from '../../../../../src/modules/forms/delivery/email.client';
import type { DeliveryFetchLike } from '../../../../../src/modules/forms/delivery/webhook-delivery.service';
import type { RecaptchaFetchLike } from '../../../../../src/modules/forms/spam/recaptcha.service';
import type { RateLimitRedisLike } from '../../../../../src/modules/forms/spam/submit-rate-limit.service';
import type { S3PresignerLike } from '../../../../../src/modules/forms/uploads/s3.service';

/** Records enqueues; scripts receive() batches for the workers (TDD §7). */
export class FakeQueueService {
  sent: Array<{ name: string; payloads: unknown[] }> = [];
  acked: Array<{ name: string; receiptHandles: string[] }> = [];
  /** Next receive() answers — shift()ed per call, then empty. */
  toReceive: Array<Array<{ body: unknown; receiptHandle: string }>> = [];

  async sendBatch(name: string, payloads: unknown[]): Promise<void> {
    if (payloads.length) this.sent.push({ name, payloads });
  }

  async receive<T>(): Promise<Array<{ body: T; receiptHandle: string }>> {
    return (this.toReceive.shift() ?? []) as Array<{ body: T; receiptHandle: string }>;
  }

  async ack(name: string, receiptHandles: string[]): Promise<void> {
    this.acked.push({ name, receiptHandles });
  }

  asQueueService(): QueueService {
    return this as unknown as QueueService;
  }
}

/** Scripted reCAPTCHA siteverify: scores, invalid tokens, or outages. */
export function fakeRecaptchaFetch(
  script: () => { ok: boolean; status: number; body?: unknown } | 'network-error',
  calls: Array<{ url: string; body: string }> = [],
): { fetch: RecaptchaFetchLike; calls: Array<{ url: string; body: string }> } {
  const fetch: RecaptchaFetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    const next = script();
    if (next === 'network-error') throw new Error('ECONNREFUSED');
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body ?? {},
    };
  };
  return { fetch, calls };
}

/** Scripted delivery POST endpoint: status codes or network errors. */
export function fakeDeliveryFetch(script: Array<number | 'network-error'>): {
  fetch: DeliveryFetchLike;
  calls: Array<{ url: string; body: string }>;
} {
  const calls: Array<{ url: string; body: string }> = [];
  const fetch: DeliveryFetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    const next = script.shift();
    if (next === undefined) throw new Error('fakeDeliveryFetch: script exhausted');
    if (next === 'network-error') throw new Error('ECONNRESET');
    return { status: next };
  };
  return { fetch, calls };
}

/** Records presign params; returns deterministic URLs (TDD §3.6). */
export class FakeS3Presigner implements S3PresignerLike {
  puts: Array<{
    bucket: string;
    region: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }> = [];
  gets: Array<{ bucket: string; region: string; key: string; expiresInSeconds: number }> = [];

  async presignPut(params: FakeS3Presigner['puts'][number]): Promise<string> {
    this.puts.push(params);
    return `https://fake-s3/${params.key}?sig=put`;
  }

  async presignGet(params: FakeS3Presigner['gets'][number]): Promise<string> {
    this.gets.push(params);
    return `https://fake-s3/${params.key}?sig=get`;
  }
}

/** Scripted email provider: 'ok' | 'fail' per send, records messages. */
export class FakeEmailClient implements EmailClientLike {
  script: Array<'ok' | 'fail'> = [];
  sent: Array<{ to: string; from: string; subject: string; text: string }> = [];

  async send(message: { to: string; from: string; subject: string; text: string }): Promise<void> {
    const next = this.script.shift() ?? 'ok';
    if (next === 'fail') throw new Error('SES send failed');
    this.sent.push(message);
  }
}

/** In-memory sorted-set Redis — enough for the sliding-window limiter. */
export class FakeRedis implements RateLimitRedisLike {
  /** key → [score, member][] */
  zsets = new Map<string, Array<[number, string]>>();
  expires = new Map<string, number>();

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<void> {
    const lo = Number(min);
    const hi = Number(max);
    this.zsets.set(
      key,
      (this.zsets.get(key) ?? []).filter(([score]) => score < lo || score > hi),
    );
  }

  async zcard(key: string): Promise<number> {
    return (this.zsets.get(key) ?? []).length;
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    const entries = this.zsets.get(key) ?? [];
    entries.push([score, member]);
    this.zsets.set(key, entries);
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expires.set(key, seconds);
  }
}
