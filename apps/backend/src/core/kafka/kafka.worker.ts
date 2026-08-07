import { Logger } from '@nestjs/common';
import { decodeEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { type Consumer, Kafka, type KafkaConfig } from 'kafkajs';

export interface KafkaHandlerMeta {
  topic: string;
  partition: number;
  attempt: number;
}

export type KafkaHandler = (payload: unknown, meta: KafkaHandlerMeta) => Promise<void>;

interface LoggerLike {
  warn(o: unknown): void;
  error(o: unknown): void;
}

export type SleepFn = (ms: number, onTick?: () => Promise<void>) => Promise<void>;

export interface MessageMeta {
  topic: string;
  partition: number;
  key?: string;
  heartbeat?: () => Promise<void>;
}

export interface ProcessMessageDeps {
  handler: KafkaHandler;
  maxAttempts: number;
  toDlq: (topic: string, payload: unknown, reason: string) => Promise<void>;
  logger: LoggerLike;
  sleep?: SleepFn;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 30_000;
const HEARTBEAT_STEP_MS = 3000;

export function computeBackoffMs(retry: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** (retry - 1));
  return Math.round(exp / 2 + (Math.random() * exp) / 2);
}

async function defaultSleep(ms: number, onTick?: () => Promise<void>): Promise<void> {
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(HEARTBEAT_STEP_MS, left);
    await new Promise((resolve) => setTimeout(resolve, chunk));
    left -= chunk;
    if (onTick) await onTick();
  }
}

export async function processKafkaMessage(
  raw: string | null,
  meta: MessageMeta,
  deps: ProcessMessageDeps,
): Promise<void> {
  const decoded =
    raw !== null ? decodeEnvelope(raw) : ({ ok: false, reason: 'invalid-json' } as const);
  if (!decoded.ok) {
    await deps.toDlq(meta.topic, { raw }, decoded.reason);
    deps.logger.error({
      msg: 'kafka message not decodable — routed to DLQ',
      topic: meta.topic,
      reason: decoded.reason,
    });
    return;
  }

  const { envelope } = decoded;
  const maxAttempts = deps.maxAttempts;
  const baseMs = deps.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const maxMs = deps.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const sleep = deps.sleep ?? defaultSleep;

  let attempt = envelope.attempt;
  while (true) {
    try {
      await deps.handler(envelope.payload, {
        topic: meta.topic,
        partition: meta.partition,
        attempt,
      });
      return;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const nextAttempt = attempt + 1;
      if (nextAttempt >= maxAttempts) {
        await deps.toDlq(meta.topic, { ...envelope, attempt }, `max attempts (${maxAttempts})`);
        deps.logger.error({
          msg: 'kafka handler failed — max attempts reached, routed to DLQ',
          topic: meta.topic,
          attempt,
          reason,
        });
        return;
      }
      const delayMs = computeBackoffMs(nextAttempt, baseMs, maxMs);
      deps.logger.warn({
        msg: 'kafka handler failed — retrying in place after backoff',
        topic: meta.topic,
        attempt: nextAttempt,
        maxAttempts,
        delayMs,
        reason,
      });
      await sleep(delayMs, meta.heartbeat);
      attempt = nextAttempt;
    }
  }
}

export interface KafkaWorkerOptions {
  topics: string[];
  groupId: string;
  handler: KafkaHandler;
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

export interface KafkaWorkerDeps {
  kafkaConfig: KafkaConfig;
  toDlq: (topic: string, payload: unknown, reason: string) => Promise<void>;
  ensureTopics?: (topics: string[]) => Promise<void>;
  clientFactory?: (cfg: KafkaConfig) => Pick<Kafka, 'consumer'>;
  logger?: LoggerLike;
  sleep?: SleepFn;
}

export class KafkaWorker {
  private readonly logger: LoggerLike;
  private consumer: Consumer | null = null;
  private running = false;

  constructor(
    private readonly deps: KafkaWorkerDeps,
    private readonly opts: KafkaWorkerOptions,
  ) {
    this.logger = deps.logger ?? new Logger(`KafkaWorker:${opts.groupId}`);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.deps.ensureTopics) await this.deps.ensureTopics(this.opts.topics);

    const client = (this.deps.clientFactory ?? ((cfg) => new Kafka(cfg)))(this.deps.kafkaConfig);
    const consumer = client.consumer({ groupId: this.opts.groupId }) as Consumer;
    this.consumer = consumer;
    await consumer.connect();
    await consumer.subscribe({ topics: this.opts.topics, fromBeginning: false });

    const processDeps: ProcessMessageDeps = {
      handler: this.opts.handler,
      maxAttempts: this.opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      toDlq: this.deps.toDlq,
      logger: this.logger,
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
      ...(this.opts.backoffBaseMs !== undefined ? { backoffBaseMs: this.opts.backoffBaseMs } : {}),
      ...(this.opts.backoffMaxMs !== undefined ? { backoffMaxMs: this.opts.backoffMaxMs } : {}),
    };

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const key = message.key?.toString();
        const meta: MessageMeta = {
          topic,
          partition,
          heartbeat,
          ...(key === undefined ? {} : { key }),
        };
        await processKafkaMessage(message.value?.toString() ?? null, meta, processDeps);
        await consumer.commitOffsets([
          { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
        ]);
      },
    });

    this.running = true;
    this.logger.warn({
      msg: 'kafka worker started',
      groupId: this.opts.groupId,
      topics: this.opts.topics,
    });
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
    this.running = false;
  }
}
