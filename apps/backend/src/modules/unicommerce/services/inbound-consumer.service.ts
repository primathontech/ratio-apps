import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Consumer } from 'kafkajs';
import type { Env } from '../../../config/env.schema';
import { createKafkaConsumer } from '../../../core/kafka/kafka-consumer.util';
import { UC_INBOUND_EVENTS_TOPIC, UcInboundQueueService } from './inbound-queue.service';

const CONSUMER_GROUP_ID = 'unicommerce-inbound-worker';

interface InboundMessage {
  jobId: string;
  merchantId: string;
  type: 'status_notify' | 'inventory_update';
}

/**
 * Kafka consumer for the additive inbound path: subscribes to
 * `unicommerce-inbound-events` (published by the standalone
 * apps/uc-inbound-ingest service after it durably enqueues a
 * `uc_inbound_jobs` row) and hands each message to
 * `UcInboundQueueService.attemptImmediate(jobId)` — the exact shape of
 * `UcOutboundConsumerService`, gated behind the same per-module env flag
 * pattern (UNICOMMERCE_INBOUND_WORKER_ENABLED, default off) so the consumer
 * only starts in deployments that opt into running it.
 */
@Injectable()
export class UcInboundConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UcInboundConsumerService.name);
  private readonly enabled: boolean;
  private readonly brokers: string[];
  private readonly clientId: string;
  private consumer: Consumer | null = null;

  constructor(
    private readonly inboundQueue: UcInboundQueueService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('UNICOMMERCE_INBOUND_WORKER_ENABLED', { infer: true }) as boolean;
    this.brokers = (config.get('KAFKA_BROKERS', { infer: true }) as string)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    this.clientId = config.get('KAFKA_CLIENT_ID', { infer: true }) as string;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('UNICOMMERCE_INBOUND_WORKER_ENABLED=false — skipping consumer start');
      return;
    }

    this.consumer = await createKafkaConsumer(
      { brokers: this.brokers, clientId: this.clientId, groupId: CONSUMER_GROUP_ID },
      [UC_INBOUND_EVENTS_TOPIC],
      async (msg) => {
        if (!msg.value) return;
        const payload = JSON.parse(msg.value) as InboundMessage;
        this.logger.log({ msg: 'consumer processing inbound job', jobId: payload.jobId, type: payload.type });
        await this.inboundQueue.attemptImmediate(payload.jobId);
      },
    );

    this.logger.log('Unicommerce inbound consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.logger.log('Unicommerce inbound consumer disconnected');
    }
  }
}
