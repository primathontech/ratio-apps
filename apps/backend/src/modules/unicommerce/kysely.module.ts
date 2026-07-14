import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { UnicommerceDatabase } from './db/types';

export const UC_DB_TOKEN = Symbol.for('ratio-app:unicommerce:db');

@Module({
  providers: [
    {
      provide: UC_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<UnicommerceDatabase> => {
        const url = config.get('RATIO_UNICOMMERCE_DATABASE_URL' as never, {
          infer: true,
        }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<UnicommerceDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [UC_DB_TOKEN],
})
export class UnicommerceKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: 'unicommerce',
      check: async () => {
        await raceWithTimeout(sql`SELECT 1`.execute(this.handle.db), 1000, 'db probe timeout');
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
