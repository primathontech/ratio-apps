import { z } from 'zod';

export const QUEUE_ENVELOPE_VERSION = 1;

export const queueEnvelopeSchema = z.object({
  v: z.literal(QUEUE_ENVELOPE_VERSION),
  attempt: z.number().int().min(0),
  enqueuedAt: z.string(),
  payload: z.unknown(),
});

export interface QueueEnvelope<T = unknown> {
  v: typeof QUEUE_ENVELOPE_VERSION;
  attempt: number;
  enqueuedAt: string;
  payload: T;
}

export function wrapEnvelope<T>(payload: T, enqueuedAt: string, attempt = 0): QueueEnvelope<T> {
  return { v: QUEUE_ENVELOPE_VERSION, attempt, enqueuedAt, payload };
}

export function withNextAttempt<T>(env: QueueEnvelope<T>): QueueEnvelope<T> {
  return { ...env, attempt: env.attempt + 1 };
}

export type EnvelopeDecodeFailure = 'invalid-json' | 'schema-mismatch';

export type EnvelopeDecodeResult =
  | { ok: true; envelope: QueueEnvelope }
  | { ok: false; reason: EnvelopeDecodeFailure };

export function decodeEnvelope(raw: string): EnvelopeDecodeResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  const parsed = queueEnvelopeSchema.safeParse(json);
  return parsed.success
    ? { ok: true, envelope: parsed.data as QueueEnvelope }
    : { ok: false, reason: 'schema-mismatch' };
}

export function parseEnvelope(raw: string): QueueEnvelope | null {
  const result = decodeEnvelope(raw);
  return result.ok ? result.envelope : null;
}
