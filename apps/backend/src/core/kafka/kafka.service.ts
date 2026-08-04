import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer, type Message as KafkaMessage, type Partitioners } from 'kafkajs';
import type { Env } from '../../config/env.schema';

export interface KafkaMessageBatch {
  topic: string;
  messages: { key: string; value: string }[];
}

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly client: Kafka;
  private producer: Producer | null = null;
  private readonly topics = new Set<string>();

  constructor(config: ConfigService<Env, true>) {
    const brokers = (config.get('KAFKA_BROKERS', { infer: true }) as string)
      ?.split(',')
      .map((b) => b.trim())
      .filter(Boolean) ?? ['localhost:9092'];
    const clientId = (config.get('KAFKA_CLIENT_ID', { infer: true }) as string | undefined) ?? 'ratio-app';
    this.client = new Kafka({ clientId, brokers });
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
      const admin = this.client.admin();
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
}
