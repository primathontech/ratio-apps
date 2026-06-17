import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { MoengageDatabase } from './db/types';

export const MOENGAGE_DB_TOKEN = Symbol.for('ratio-app:moengage:db');

/**
 * Per-module Kysely client. NOT `@Global()`: the token is consumed only by
 * providers within `MoengageModule` (which imports this module in its
 * `imports[]`). Cross-module access is intentionally blocked.
 */
@Module({
  providers: [
    {
      provide: MOENGAGE_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<MoengageDatabase> => {
        const url = config.get('RATIO_MOENGAGE_DATABASE_URL' as never, {
          infer: true,
        }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<MoengageDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [MOENGAGE_DB_TOKEN],
})
export class MoengageKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(MOENGAGE_DB_TOKEN) private readonly handle: KyselyClient<MoengageDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: 'moengage',
      // Raw `SELECT 1` — no table dependency, no planner cost.
      // Wrapped in Promise.race with a 1-second timeout so a degraded DB
      // can't hold a pool connection past the /ready latency budget.
      // Matches the 1000 ms cap in HealthController so the two layers
      // don't drift; this layer caps connection-hold time (the controller
      // layer caps total request latency).
      check: async () => {
        await raceWithTimeout(sql`SELECT 1`.execute(this.handle.db), 1000, 'db probe timeout');
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
