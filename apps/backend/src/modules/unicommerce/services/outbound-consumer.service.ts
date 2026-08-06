import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Consumer } from 'kafkajs';
import type { Env } from '../../../config/env.schema';
import { createKafkaConsumer } from '../../../core/kafka/kafka-consumer.util';
import { UcSyncQueueService } from './sync-queue.service';

const UC_ORDER_PUSH_TOPIC = 'unicommerce-order-push';
const UC_ORDER_CANCEL_TOPIC = 'unicommerce-order-cancel';
const CONSUMER_GROUP_ID = 'unicommerce-outbound-worker';

interface OrderPushMessage {
  jobId: string;
  merchantId: string;
  type: 'order_push';
  ratioOrderId: string;
}

interface CancelPushMessage {
  jobId: string;
  merchantId: string;
  type: 'cancel_push';
  ratioOrderId: string;
}

type OutboundMessage = OrderPushMessage | CancelPushMessage;

@Injectable()
export class UcOutboundConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UcOutboundConsumerService.name);
  private readonly enabled: boolean;
  private readonly brokers: string[];
  private readonly clientId: string;
  private consumer: Consumer | null = null;

  constructor(
    private readonly syncQueue: UcSyncQueueService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('UNICOMMERCE_OUTBOUND_WORKER_ENABLED', { infer: true }) as boolean;
    this.brokers = (config.get('KAFKA_BROKERS', { infer: true }) as string)
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    this.clientId = config.get('KAFKA_CLIENT_ID', { infer: true }) as string;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('UNICOMMERCE_OUTBOUND_WORKER_ENABLED=false — skipping consumer start');
      return;
    }

    await this.syncQueue.ensureTopics();

    this.consumer = await createKafkaConsumer(
      { brokers: this.brokers, clientId: this.clientId, groupId: CONSUMER_GROUP_ID },
      [UC_ORDER_PUSH_TOPIC, UC_ORDER_CANCEL_TOPIC],
      async (msg) => {
        if (!msg.value) return;
        const payload = JSON.parse(msg.value) as OutboundMessage;
        this.logger.log({ msg: 'consumer processing outbound job', jobId: payload.jobId, type: payload.type });
        await this.syncQueue.attemptImmediate(payload.jobId);
      },
    );

    this.logger.log('Unicommerce outbound consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.logger.log('Unicommerce outbound consumer disconnected');
    }
  }
}
