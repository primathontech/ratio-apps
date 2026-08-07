import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dlqTopic } from '@ratio-app/shared/constants/kafka-topics';
import { type QueueEnvelope, wrapEnvelope } from '@ratio-app/shared/schemas/queue-envelope';
import { type Admin, Kafka, type Message as KafkaMessage, type Producer } from 'kafkajs';
import type { Env } from '../../config/env.schema';
import { kafkaConfigFromEnv } from './kafka.config';

export interface KafkaMessageBatch {
  topic: string;
  messages: { key: string; value: string }[];
}

type KafkaLike = Pick<Kafka, 'producer' | 'admin'>;
type ProducerLike = Pick<Producer, 'connect' | 'disconnect' | 'send'>;
type AdminLike = Pick<Admin, 'connect' | 'disconnect' | 'listTopics' | 'createTopics'>;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly client: KafkaLike;
  private producer: ProducerLike | null = null;
  private connecting: Promise<ProducerLike> | null = null;
  private readonly topics = new Set<string>();
  private readonly defaultPartitions: number;
  private readonly replicationFactor: number;

  constructor(config: ConfigService<Env, true>, @Optional() client?: KafkaLike) {
    this.defaultPartitions = readConfigNumber(config, 'KAFKA_TOPIC_PARTITIONS', 3);
    this.replicationFactor = readConfigNumber(config, 'KAFKA_TOPIC_REPLICATION_FACTOR', 1);
    if (client) {
      this.client = client;
      return;
    }
    this.client = new Kafka(kafkaConfigFromEnv(config));
  }

  onModuleInit(): void {
    void this.ensureProducer().catch((err) => {
      this.logger.warn({
        msg: 'Kafka producer connect deferred (will retry on first send)',
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }

  private ensureProducer(): Promise<ProducerLike> {
    if (this.producer) return Promise.resolve(this.producer);
    if (!this.connecting) {
      const producer = this.client.producer();
      this.connecting = producer
        .connect()
        .then(() => {
          this.producer = producer;
          this.logger.log('Kafka producer connected');
          return producer;
        })
        .catch((err) => {
          this.connecting = null;
          throw err;
        });
    }
    return this.connecting;
  }

  async ensureTopic(name: string, partitions?: number): Promise<void> {
    if (this.topics.has(name)) return;
    const numPartitions = partitions ?? this.defaultPartitions;
    const admin = this.client.admin() as AdminLike;
    try {
      await admin.connect();
      const existing = await admin.listTopics();
      if (!existing.includes(name)) {
        await admin.createTopics({
          topics: [{ topic: name, numPartitions, replicationFactor: this.replicationFactor }],
        });
        this.logger.log({
          msg: 'Kafka topic created',
          topic: name,
          partitions: numPartitions,
          replicationFactor: this.replicationFactor,
        });
      }
      this.topics.add(name);
    } catch (err) {
      this.logger.warn({
        msg: 'Kafka ensureTopic failed — will retry on next call',
        topic: name,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  async send(batch: KafkaMessageBatch): Promise<void> {
    const producer = await this.ensureProducer();
    await producer.send({
      topic: batch.topic,
      messages: batch.messages as KafkaMessage[],
    });
  }

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

  async sendEnvelope(topic: string, envelope: QueueEnvelope, key?: string): Promise<void> {
    await this.send({
      topic,
      messages: [{ key: key ?? (null as unknown as string), value: JSON.stringify(envelope) }],
    });
  }

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

function readConfigNumber(
  config: ConfigService<Env, true>,
  key: 'KAFKA_TOPIC_PARTITIONS' | 'KAFKA_TOPIC_REPLICATION_FACTOR',
  fallback: number,
): number {
  try {
    const value = config.get(key, { infer: true }) as number | undefined;
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
