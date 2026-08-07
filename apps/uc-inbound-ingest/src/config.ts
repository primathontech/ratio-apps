import { z } from 'zod';

/**
 * Env contract for the standalone UC inbound-ingest app. Mirrors the backend's
 * KAFKA_* defaults (`KAFKA_BROKERS` default `localhost:9092`, `KAFKA_CLIENT_ID`
 * default `ratio-app`) so a local/dev deployment of this app talks to the same
 * cluster as the backend's own Kafka producer/consumer.
 */
const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  // Same `unicommerce_app` database the backend's unicommerce module owns
  // (`RATIO_UNICOMMERCE_DATABASE_URL=mysql://app:app@localhost:3308/unicommerce_app`
  // in docker-compose). Reuses the EXISTING tables (uc_access_tokens,
  // uc_credentials, uc_order_item_map) for auth + local checks; the only table
  // this app writes is `uc_inbound_jobs`.
  DATABASE_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('ratio-app'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/** Fail-fast env validation, mirroring the backend's `loadEnv` call before bootstrap. */
export function loadEnv(env: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid uc-inbound-ingest env: ${detail}`);
  }
  return parsed.data;
}
