import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { Env } from '../../config/env.schema';
import { raceWithTimeout } from '../../core/common/race-with-timeout';
import { createKyselyClient, type KyselyClient } from '../../core/db/kysely-factory';
import { HealthRegistry } from '../../core/health/health-registry.service';
import type { TemplateDatabase } from './db/types';

export const TEMPLATE_DB_TOKEN = Symbol.for('ratio-app:_template:db');

/**
 * Per-module Kysely client. Each module owns its own MySQL pool against its
 * own database (`RATIO_TEMPLATE_DATABASE_URL`). Registers a `'_template'` probe
 * with the global `HealthRegistry` so `/ready` aggregates per-module health.
 *
 * NOT `@Global()`: the token is consumed only by providers within
 * `TemplateModule` (and that module imports this one in its `imports[]`).
 * Keeping the scope tight prevents accidental cross-module DB access, which
 * was a latent footgun under the previous global-export pattern.
 *
 * Closes the pool on `OnApplicationShutdown` so e2e teardown + graceful SIGTERM
 * release sockets cleanly.
 */
@Module({
  providers: [
    {
      provide: TEMPLATE_DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): KyselyClient<TemplateDatabase> => {
        const url = config.get('RATIO_TEMPLATE_DATABASE_URL' as never, {
          infer: true,
        }) as string;
        const poolSize = config.get('DB_POOL_SIZE', { infer: true }) as number;
        return createKyselyClient<TemplateDatabase>(url, { poolSize });
      },
    },
  ],
  exports: [TEMPLATE_DB_TOKEN],
})
export class TemplateKyselyModule implements OnApplicationShutdown {
  constructor(
    @Inject(TEMPLATE_DB_TOKEN) private readonly handle: KyselyClient<TemplateDatabase>,
    private readonly health: HealthRegistry,
  ) {
    this.health.register({
      name: '_template',
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
