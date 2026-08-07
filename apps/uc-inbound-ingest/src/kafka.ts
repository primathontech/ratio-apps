import { Kafka, type Producer } from 'kafkajs';
import type { Logger } from './logger';

/**
 * The single inbound Kafka topic. Hardcoded here AND in the backend's
 * UcInboundQueueService (UC_INBOUND_EVENTS_TOPIC) — deliberately NOT
 * env-configurable on either side so the producer and consumer can never drift
 * apart on topic name.
 */
export const INBOUND_EVENTS_TOPIC = 'unicommerce-inbound-events';

export interface InboundEventMessage {
  jobId: string;
  merchantId: string;
  type: 'status_notify' | 'inventory_update';
}

export interface Publisher {
  publish(message: InboundEventMessage): Promise<void>;
}

export interface KafkaPublisher extends Publisher {
  ensureTopic(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Kafka producer wrapper mirroring core/kafka/kafka.service.ts: brokers come
 * from a comma-separated env var (default `localhost:9092`), clientId defaults
 * to `ratio-app`, ensureTopic is non-fatal in dev, and the producer connects
 * lazily on first publish (a down broker must never fail a request — the DB row
 * is the durable record; callers log-and-swallow).
 */
export function createPublisher(
  brokersCsv: string,
  clientId: string,
  logger: Logger,
): KafkaPublisher {
  const brokers = brokersCsv
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  const client = new Kafka({ clientId: clientId || 'ratio-app', brokers });

  let producer: Producer | null = null;
  const topicsKnown = new Set<string>();

  return {
    async publish(message: InboundEventMessage): Promise<void> {
      if (!producer) {
        producer = client.producer();
        await producer.connect();
      }
      await producer.send({
        topic: INBOUND_EVENTS_TOPIC,
        messages: [{ key: message.jobId, value: JSON.stringify(message) }],
      });
    },

    async ensureTopic(): Promise<void> {
      if (topicsKnown.has(INBOUND_EVENTS_TOPIC)) return;
      try {
        const admin = client.admin();
        await admin.connect();
        const existing = await admin.listTopics();
        if (!existing.includes(INBOUND_EVENTS_TOPIC)) {
          await admin.createTopics({
            topics: [{ topic: INBOUND_EVENTS_TOPIC, numPartitions: 3, replicationFactor: 1 }],
          });
          logger.info({ msg: 'kafka topic created', topic: INBOUND_EVENTS_TOPIC, partitions: 3 });
        }
        await admin.disconnect();
        topicsKnown.add(INBOUND_EVENTS_TOPIC);
      } catch (err) {
        logger.warn({
          msg: 'kafka ensureTopic failed (non-fatal)',
          topic: INBOUND_EVENTS_TOPIC,
          err: err instanceof Error ? err.message : String(err),
        });
        topicsKnown.add(INBOUND_EVENTS_TOPIC);
      }
    },

    async close(): Promise<void> {
      if (producer) {
        await producer.disconnect();
      }
    },
  };
}
