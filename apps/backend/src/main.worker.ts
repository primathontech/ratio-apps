import 'reflect-metadata';
process.env.DOTENV_CONFIG_PATH = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
import 'dotenv/config';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './config/env.schema';

/**
 * Worker entrypoint — same AppModule as the API, but boots an application
 * CONTEXT (no HTTP listener). The queue/stream consumers (GoogleProductSyncWorker,
 * MetaCapiWorker, …) start via their own onModuleInit gating (`*_WORKER_ENABLED`),
 * which a worker deployment sets true and API deployments leave false.
 * `enableShutdownHooks` + each worker's onModuleDestroy give a clean SIGTERM drain.
 */
async function bootstrapWorker(): Promise<void> {
  loadEnv(process.env); // fail-fast before logger setup
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  new NestLogger('Worker').log({
    msg: 'worker started',
    enabledModules: process.env.ENABLED_MODULES ?? 'all',
    enabledQueues: process.env.ENABLED_QUEUES ?? 'all',
  });
}

bootstrapWorker().catch((err) => {
  console.error('worker bootstrap failed:', err);
  process.exit(1);
});
