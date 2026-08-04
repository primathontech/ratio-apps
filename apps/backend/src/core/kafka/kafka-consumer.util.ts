import { Logger } from '@nestjs/common';
import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

const logger = new Logger('KafkaConsumer');

export interface ConsumerMessage {
  topic: string;
  partition: number;
  key: string | null;
  value: string | null;
}

export async function createKafkaConsumer(
  config: { brokers: string[]; clientId: string; groupId: string },
  topics: string[],
  handler: (message: ConsumerMessage) => Promise<void>,
): Promise<Consumer> {
  const client = new Kafka({
    clientId: config.clientId,
    brokers: config.brokers,
  });

  const consumer = client.consumer({ groupId: config.groupId });

  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      const msg: ConsumerMessage = {
        topic: payload.topic,
        partition: payload.partition,
        key: payload.message.key?.toString() ?? null,
        value: payload.message.value?.toString() ?? null,
      };
      try {
        await handler(msg);
      } catch (err) {
        logger.error({
          msg: 'Kafka consumer handler threw — offset NOT committed, message will redeliver',
          topic: msg.topic,
          partition: msg.partition,
          key: msg.key,
          err: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  });

  logger.log({ msg: 'Kafka consumer started', groupId: config.groupId, topics });
  return consumer;
}
