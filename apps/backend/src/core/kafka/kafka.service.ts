import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
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
  private readonly topics = new Set<string>();

  constructor(config: ConfigService<Env, true>, client?: KafkaLike) {
    if (client) {
      this.client = client;
      return;
    }
    this.client = new Kafka(kafkaConfigFromEnv(config));
  }

  // Connect eagerly but tolerate a down broker: boot must not hinge on Kafka
  // (a shared-API pod may run with the forwarding worker off and never produce).
  // send() lazily retries the connection.
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureProducer();
    } catch (err) {
      this.logger.warn({
        msg: 'Kafka producer connect deferred (will retry on first send)',
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.logger.log('Kafka producer disconnected');
    }
  }

  private async ensureProducer(): Promise<ProducerLike> {
    if (this.producer) return this.producer;
    const producer = this.client.producer();
    await producer.connect();
    this.producer = producer;
    this.logger.log('Kafka producer connected');
    return producer;
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
