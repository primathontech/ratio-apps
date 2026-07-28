import type { Readable } from 'node:stream';
import type { EmailMessage, EmailService } from '../../../../../src/core/email/email.service';
import type { QueueService } from '../../../../../src/core/queue/queue.service';
import type { S3Service } from '../../../../../src/core/storage/s3.service';
import type { DeliveryFetchLike } from '../../../../../src/modules/forms/outbound/webhook-delivery.service';
import type { RecaptchaFetchLike } from '../../../../../src/modules/forms/spam/recaptcha.service';
import type { RateLimitRedisLike } from '../../../../../src/modules/forms/spam/submit-rate-limit.service';

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

/**
 * Fake core {@link S3Service} — the transport seam `FormsS3Service` now
 * delegates to (presign PUT/GET, HEAD, streaming upload). Records every call so
 * tests can assert the forms policy (per-call bucket, draft-key layout,
 * expiries, forced `attachment` disposition, streamed bytes) and returns
 * deterministic URLs (TDD §3.6).
 */
export class FakeS3Service {
  puts: Array<{
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
  }> = [];
  gets: Array<{
    bucket: string;
    key: string;
    expiresSeconds: number;
    responseContentDisposition?: string;
  }> = [];
  /** Recorded streaming uploads with the drained body bytes per key. */
  uploads: Array<{ bucket: string; key: string; contentType: string; body: string }> = [];
  /** Recorded HEAD existence checks. */
  heads: Array<{ bucket: string; key: string }> = [];

  /** Verdict returned by {@link headExists} (boolean or per-call fn). */
  headResult: boolean | (() => boolean) = true;
  /** When true the next {@link uploadStream} rejects, exercising failure paths. */
  failUpload = false;

  async presignPutUrl(
    bucket: string,
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<string> {
    this.puts.push({ bucket, key, ...opts });
    return `https://fake-s3/${key}?sig=put`;
  }

  async presignGetUrl(
    bucket: string,
    key: string,
    expiresSeconds: number,
    responseContentDisposition?: string,
  ): Promise<string> {
    this.gets.push({ bucket, key, expiresSeconds, responseContentDisposition });
    return `https://fake-s3/${key}?sig=get`;
  }

  async headExists(bucket: string, key: string): Promise<boolean> {
    this.heads.push({ bucket, key });
    return typeof this.headResult === 'function' ? this.headResult() : this.headResult;
  }

  async uploadStream(
    bucket: string,
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      body.on('data', (c: Buffer | string) => chunks.push(Buffer.from(c)));
      body.on('error', reject);
      body.on('end', resolve);
    });
    if (this.failUpload) throw new Error('S3 upload failed');
    this.uploads.push({ bucket, key, contentType, body: Buffer.concat(chunks).toString('utf8') });
  }

  asS3Service(): S3Service {
    return this as unknown as S3Service;
  }
}

/** Scripted core EmailService: 'ok' | 'fail' per send, records messages. */
export class FakeEmailService {
  script: Array<'ok' | 'fail'> = [];
  sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<boolean> {
    const next = this.script.shift() ?? 'ok';
    if (next === 'fail') throw new Error('SES send failed');
    this.sent.push(message);
    return true;
  }

  asEmailService(): EmailService {
    return this as unknown as EmailService;
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
