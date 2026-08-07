import { config as loadDotenv } from 'dotenv';

// Functional mirror of apps/backend/src/main.ts: pick the env file by NODE_ENV
// (.env.production in prod, .env otherwise) BEFORE any config is parsed. Uses
// the explicit dotenv.config({ path }) call (instead of the backend's
// process.env.DOTENV_CONFIG_PATH + `import 'dotenv/config'` trick) so the
// file-selection behavior is identical without depending on TS emit order.
loadDotenv({ path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env' });

import { buildApp } from './app';
import { loadEnv } from './config';
import { createDb } from './db';
import { createPublisher } from './kafka';
import { createLogger } from './logger';

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL);
  const publisher = createPublisher(env.KAFKA_BROKERS, env.KAFKA_CLIENT_ID, logger);

  // Non-fatal: a down Kafka cluster must not block startup — publish failures
  // are already log-and-swallowed per-request.
  await publisher.ensureTopic();

  const app = buildApp({ db, publish: (msg) => publisher.publish(msg), logger });
  app.addHook('onClose', async () => {
    await publisher.close();
    await db.close();
  });

  const shutdown = (signal: string): void => {
    logger.info({ msg: 'shutting down', signal });
    app.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ msg: 'uc-inbound-ingest listening', port: env.PORT });
}

bootstrap().catch((err) => {
  console.error(
    'bootstrap failed:',
    err instanceof Error ? (err.stack ?? err.message) : String(err),
  );
  process.exit(1);
});
