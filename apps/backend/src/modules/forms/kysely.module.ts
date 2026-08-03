import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { FormsDatabase } from './db/types';

export const FORMS_DB_TOKEN = Symbol.for('ratio-app:forms:db');

/** Per-module Kysely client (own MySQL pool); NOT @Global() to prevent cross-module DB access; registers a 'forms' health probe and closes the pool on shutdown. */
@Module({
  providers: [
    {
      provide: FORMS_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<FormsDatabase> => {
        const url = config.get('RATIO_FORMS_DATABASE_URL' as never, {
          infer: true,
        }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<FormsDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [FORMS_DB_TOKEN],
})
export class FormsKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: 'forms',
      // Raw `SELECT 1` with a 1s timeout so a degraded DB can't hold a pool connection past the /ready budget (matches HealthController's cap).
      check: async () => {
        await raceWithTimeout(sql`SELECT 1`.execute(this.handle.db), 1000, 'db probe timeout');
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
