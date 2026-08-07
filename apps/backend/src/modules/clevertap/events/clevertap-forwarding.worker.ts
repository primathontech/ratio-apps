import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CLEVERTAP_FORWARDING_TOPIC } from '@ratio-app/shared/constants/kafka-topics';
import type { Env } from '../../../config/env.schema';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { kafkaConfigFromEnv } from '../../../core/kafka/kafka.config';
import { KafkaService } from '../../../core/kafka/kafka.service';
import { KafkaWorker } from '../../../core/kafka/kafka.worker';
import type { ClevertapConfigRow, ClevertapDatabase, ClevertapForwardStatus } from '../db/types';
import { CLEVERTAP_DB_TOKEN } from '../kysely.module';
import {
  CLEVERTAP_APP_ENABLED,
  CLEVERTAP_CRYPTO,
  CLEVERTAP_FORWARD_WORKER_ENABLED,
} from '../tokens';
import {
  CLEVERTAP_EVENTS_CLIENT_FACTORY,
  type ClevertapEventsClientFactory,
} from './clevertap-events.client';
import { apiHostFor, skipReasonFor } from './forwarding.service';
import type { ClevertapUploadRecord } from './order-event.mapper';

const GROUP_ID = 'clevertap-forwarding';
const MAX_ERROR_LEN = 500;

interface ForwardMessage {
  merchantId: string;
  topic: string;
  idempotencyKey: string;
  clevertapEvent: string;
  records: ClevertapUploadRecord[];
}

@Injectable()
export class ClevertapForwardingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClevertapForwardingWorker.name);
  private worker: KafkaWorker | null = null;

  constructor(
    @Inject(CLEVERTAP_DB_TOKEN) private readonly handle: KyselyClient<ClevertapDatabase>,
    @Inject(CLEVERTAP_CRYPTO) private readonly crypto: Pick<CryptoService, 'decrypt'>,
    @Inject(CLEVERTAP_EVENTS_CLIENT_FACTORY)
    private readonly clientFactory: ClevertapEventsClientFactory,
    private readonly kafka: KafkaService,
    private readonly config: ConfigService<Env, true>,
    @Optional() @Inject(CLEVERTAP_APP_ENABLED) private readonly platformEnabled = true,
    @Optional() @Inject(CLEVERTAP_FORWARD_WORKER_ENABLED) private readonly enabled = false,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    const maxAttempts = this.config.get('CLEVERTAP_FORWARD_MAX_ATTEMPTS', {
      infer: true,
    }) as number;
    this.worker = new KafkaWorker(
      {
        kafkaConfig: kafkaConfigFromEnv(this.config),
        reproduce: (topic, envelope, key) => this.kafka.sendEnvelope(topic, envelope, key),
        toDlq: (topic, payload, reason) => this.kafka.sendToDlq(topic, payload, reason),
        ensureTopics: async (topics) => {
          for (const t of topics) await this.kafka.ensureTopic(t);
        },
        logger: this.logger,
      },
      {
        topics: [CLEVERTAP_FORWARDING_TOPIC],
        groupId: GROUP_ID,
        maxAttempts,
        handler: (payload) => this.deliver(payload as ForwardMessage),
      },
    );
    await this.worker.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.stop();
  }

  async deliver(msg: ForwardMessage): Promise<void> {
    const config = await this.handle.db
      .selectFrom('clevertap_configs')
      .selectAll()
      .where('merchantId', '=', msg.merchantId)
      .limit(1)
      .executeTakeFirst();

    const skip = skipReasonFor(config, this.platformEnabled, msg.topic, msg.clevertapEvent);
    if (skip !== null) {
      await this.mark(msg, 'skipped', skip);
      this.logger.log({
        msg: 'forwarding skipped at delivery',
        merchantId: msg.merchantId,
        reason: skip,
      });
      return;
    }
    const row = config as ClevertapConfigRow & { passcodeEnc: string };

    const existing = await this.handle.db
      .selectFrom('clevertap_forwarded_events')
      .select('status')
      .where('merchantId', '=', msg.merchantId)
      .where('idempotencyKey', '=', msg.idempotencyKey)
      .limit(1)
      .executeTakeFirst();
    if (existing?.status === 'sent') return;

    const client = this.clientFactory(apiHostFor(row.region));
    const result = await client.upload({
      accountId: row.accountId,
      passcode: this.crypto.decrypt(row.passcodeEnc),
      records: msg.records,
    });

    if (result.ok) {
      await this.mark(msg, 'sent', null);
      this.logger.log({
        msg: 'forwarded to clevertap',
        merchantId: msg.merchantId,
        topic: msg.topic,
      });
      return;
    }
    const error = result.error ?? `clevertap ${result.status}`;
    await this.mark(msg, 'failed', error);
    throw new Error(error);
  }

  private async mark(
    msg: ForwardMessage,
    status: ClevertapForwardStatus,
    error: string | null,
  ): Promise<void> {
    await this.handle.db
      .updateTable('clevertap_forwarded_events')
      .set({ status, error: error ? error.slice(0, MAX_ERROR_LEN) : null })
      .where('merchantId', '=', msg.merchantId)
      .where('idempotencyKey', '=', msg.idempotencyKey)
      .execute();
  }
}
