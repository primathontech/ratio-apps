import type { KafkaConfig, SASLOptions } from 'kafkajs';
import type { Env } from '../../config/env.schema';

export type KafkaEnv = Pick<
  Env,
  | 'KAFKA_BROKERS'
  | 'KAFKA_CLIENT_ID'
  | 'KAFKA_SSL'
  | 'KAFKA_SASL_MECHANISM'
  | 'KAFKA_SASL_USERNAME'
  | 'KAFKA_SASL_PASSWORD'
  | 'KAFKA_CONNECTION_TIMEOUT_MS'
>;

export function buildKafkaConfig(env: KafkaEnv): KafkaConfig {
  const brokers = env.KAFKA_BROKERS.split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  const sasl: SASLOptions | undefined =
    env.KAFKA_SASL_MECHANISM && env.KAFKA_SASL_USERNAME && env.KAFKA_SASL_PASSWORD
      ? ({
          mechanism: env.KAFKA_SASL_MECHANISM,
          username: env.KAFKA_SASL_USERNAME,
          password: env.KAFKA_SASL_PASSWORD,
        } as SASLOptions)
      : undefined;

  return {
    clientId: env.KAFKA_CLIENT_ID,
    brokers,
    ssl: env.KAFKA_SSL,
    ...(sasl ? { sasl } : {}),
    connectionTimeout: env.KAFKA_CONNECTION_TIMEOUT_MS,
    retry: { retries: 8 },
  };
}
