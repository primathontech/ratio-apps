import { Logger } from '@nestjs/common';
import {
  parseEnvelope,
  type QueueEnvelope,
  withNextAttempt,
} from '@ratio-app/shared/schemas/queue-envelope';
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

export interface ProcessMessageDeps {
  handler: KafkaHandler;
  maxAttempts: number;
  reproduce: (topic: string, envelope: QueueEnvelope, key?: string) => Promise<void>;
  toDlq: (topic: string, payload: unknown, reason: string) => Promise<void>;
  logger: LoggerLike;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export async function processKafkaMessage(
  raw: string | null,
  meta: { topic: string; partition: number; key?: string },
  deps: ProcessMessageDeps,
): Promise<void> {
  const envelope = raw !== null ? parseEnvelope(raw) : null;
  if (!envelope) {
    await deps.toDlq(meta.topic, { raw }, 'unparseable');
    deps.logger.error({ msg: 'kafka message unparseable — routed to DLQ', topic: meta.topic });
    return;
  }

  try {
    await deps.handler(envelope.payload, {
      topic: meta.topic,
      partition: meta.partition,
      attempt: envelope.attempt,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const nextAttempt = envelope.attempt + 1;
    if (nextAttempt < deps.maxAttempts) {
      await deps.reproduce(meta.topic, withNextAttempt(envelope), meta.key);
      deps.logger.warn({
        msg: 'kafka handler failed — re-enqueued for retry',
        topic: meta.topic,
        attempt: nextAttempt,
        maxAttempts: deps.maxAttempts,
        reason,
      });
    } else {
      await deps.toDlq(meta.topic, envelope, `max attempts (${deps.maxAttempts})`);
      deps.logger.error({
        msg: 'kafka handler failed — max attempts reached, routed to DLQ',
        topic: meta.topic,
        attempt: envelope.attempt,
        reason,
      });
    }
  }
}

export interface KafkaWorkerOptions {
  topics: string[];
  groupId: string;
  handler: KafkaHandler;
  maxAttempts?: number;
}

export interface KafkaWorkerDeps {
  kafkaConfig: KafkaConfig;
  reproduce: (topic: string, envelope: QueueEnvelope, key?: string) => Promise<void>;
  toDlq: (topic: string, payload: unknown, reason: string) => Promise<void>;
  ensureTopics?: (topics: string[]) => Promise<void>;
  clientFactory?: (cfg: KafkaConfig) => Pick<Kafka, 'consumer'>;
  logger?: LoggerLike;
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
      reproduce: this.deps.reproduce,
      toDlq: this.deps.toDlq,
      logger: this.logger,
    };

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const key = message.key?.toString();
        await processKafkaMessage(
          message.value?.toString() ?? null,
          key === undefined ? { topic, partition } : { topic, partition, key },
          processDeps,
        );
        await consumer.commitOffsets([
          { topic, partition, offset: (Number(message.offset) + 1).toString() },
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
