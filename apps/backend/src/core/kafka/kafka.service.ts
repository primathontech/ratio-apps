import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dlqTopic } from '@ratio-app/shared/constants/kafka-topics';
import { wrapEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { type Admin, Kafka, type Message as KafkaMessage, type Producer } from 'kafkajs';
import type { Env } from '../../config/env.schema';
import { buildKafkaConfig, type KafkaEnv } from './kafka.config';

export interface KafkaMessageBatch {
  topic: string;
  messages: { key: string; value: string }[];
}

type KafkaLike = Pick<Kafka, 'producer' | 'admin'>;
type ProducerLike = Pick<Producer, 'connect' | 'disconnect' | 'send'>;
type AdminLike = Pick<Admin, 'connect' | 'disconnect' | 'listTopics' | 'createTopics'>;

const KAFKA_ENV_KEYS: (keyof KafkaEnv)[] = [
  'KAFKA_BROKERS',
  'KAFKA_CLIENT_ID',
  'KAFKA_SSL',
  'KAFKA_SASL_MECHANISM',
  'KAFKA_SASL_USERNAME',
  'KAFKA_SASL_PASSWORD',
  'KAFKA_CONNECTION_TIMEOUT_MS',
];

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly client: KafkaLike;
  private producer: ProducerLike | null = null;
  private readonly topics = new Set<string>();

  // `client` is injectable so unit tests pass an in-memory fake; production
  // builds the real kafkajs client from validated env (brokers/SSL/SASL).
  constructor(config: ConfigService<Env, true>, client?: KafkaLike) {
    if (client) {
      this.client = client;
      return;
    }
    const env = Object.fromEntries(
      KAFKA_ENV_KEYS.map((k) => [k, config.get(k, { infer: true })]),
    ) as KafkaEnv;
    this.client = new Kafka(buildKafkaConfig(env));
  }

  async onModuleInit(): Promise<void> {
    this.producer = this.client.producer();
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }

  async ensureTopic(name: string, partitions = 3): Promise<void> {
    if (this.topics.has(name)) return;
    try {
      const admin = this.client.admin() as AdminLike;
      await admin.connect();
      const existing = await admin.listTopics();
      if (!existing.includes(name)) {
        await admin.createTopics({
          topics: [{ topic: name, numPartitions: partitions, replicationFactor: 1 }],
        });
        this.logger.log({ msg: 'Kafka topic created', topic: name, partitions });
      }
      await admin.disconnect();
      this.topics.add(name);
    } catch (err) {
      this.logger.warn({
        msg: 'Kafka ensureTopic failed (non-fatal in dev)',
        topic: name,
        err: err instanceof Error ? err.message : String(err),
      });
      this.topics.add(name);
    }
  }

  async send(batch: KafkaMessageBatch): Promise<void> {
    if (!this.producer) throw new Error('Kafka producer not connected');
    await this.producer.send({
      topic: batch.topic,
      messages: batch.messages as KafkaMessage[],
    });
  }

  // Envelope-wrapping producer: every payload becomes a versioned envelope with
  // an attempt counter, and an optional key sets the partition so a keyed
  // pipeline (e.g. per-merchant) keeps its ordering.
  async produce(
    topic: string,
    payloads: unknown[],
    keyFn?: (payload: unknown) => string,
  ): Promise<void> {
    if (!payloads.length) return;
    const enqueuedAt = new Date().toISOString();
    await this.send({
      topic,
      messages: payloads.map((p) => ({
        key: keyFn ? keyFn(p) : (null as unknown as string),
        value: JSON.stringify(wrapEnvelope(p, enqueuedAt)),
      })),
    });
  }

  // Route a poison message to `${topic}.dlq` so nothing vanishes unexplained
  // (Kafka has no redrive; the worker calls this after maxAttempts or on an
  // unparseable body, then commits the original offset to make progress).
  async sendToDlq(topic: string, payload: unknown, reason: string): Promise<void> {
    await this.send({
      topic: dlqTopic(topic),
      messages: [
        {
          key: null as unknown as string,
          value: JSON.stringify({ reason, failedAt: new Date().toISOString(), payload }),
        },
      ],
    });
  }
}
