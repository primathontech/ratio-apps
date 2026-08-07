import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { ClevertapDatabase } from './db/types';

export const CLEVERTAP_DB_TOKEN = Symbol.for('ratio-app:clevertap:db');

@Module({
  providers: [
    {
      provide: CLEVERTAP_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<ClevertapDatabase> => {
        const url = config.get('RATIO_CLEVERTAP_DATABASE_URL' as never, {
          infer: true,
        }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<ClevertapDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [CLEVERTAP_DB_TOKEN],
})
export class ClevertapKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(CLEVERTAP_DB_TOKEN) private readonly handle: KyselyClient<ClevertapDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: 'clevertap',
      check: async () => {
        await raceWithTimeout(sql`SELECT 1`.execute(this.handle.db), 1000, 'db probe timeout');
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
