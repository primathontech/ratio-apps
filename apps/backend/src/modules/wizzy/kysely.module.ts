import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { WizzyDatabase } from './db/types';

export const WIZZY_DB_TOKEN = Symbol.for('ratio-app:wizzy:db');

/**
 * Per-module Kysely client. Each module owns its own MySQL pool against its
 * own database (`RATIO_WIZZY_DATABASE_URL`). Registers a `'wizzy'` probe
 * with the global `HealthRegistry` so `/ready` aggregates per-module health.
 *
 * NOT `@Global()`: the token is consumed only by providers within
 * `WizzyModule` (and that module imports this one in its `imports[]`).
 */
@Module({
  providers: [
    {
      provide: WIZZY_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<WizzyDatabase> => {
        const url = config.get('RATIO_WIZZY_DATABASE_URL' as never, {
          infer: true,
        }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<WizzyDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [WIZZY_DB_TOKEN],
})
export class WizzyKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: 'wizzy',
      check: async () => {
        await raceWithTimeout(sql`SELECT 1`.execute(this.handle.db), 1000, 'db probe timeout');
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
