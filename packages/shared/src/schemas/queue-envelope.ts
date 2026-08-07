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

export function parseEnvelope(raw: string): QueueEnvelope | null {
  try {
    const parsed = queueEnvelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as QueueEnvelope) : null;
  } catch {
    return null;
  }
}
