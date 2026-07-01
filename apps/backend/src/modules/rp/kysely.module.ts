import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { RpDatabase } from './db/types';

export const RP_DB_TOKEN = Symbol.for('ratio-app:rp:db');

@Module({
  providers: [
    {
      provide: RP_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<RpDatabase> => {
        const url = config.get('RATIO_RP_DATABASE_URL' as never, { infer: true }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<RpDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [RP_DB_TOKEN],
})
export class RpKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(RP_DB_TOKEN) private readonly handle: KyselyClient<RpDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: 'rp',
      check: async () => {
        await raceWithTimeout(sql`SELECT 1`.execute(this.handle.db), 1000, 'db probe timeout');
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
