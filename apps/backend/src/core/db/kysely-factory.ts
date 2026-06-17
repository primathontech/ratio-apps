import { CamelCasePlugin, type Kysely, Kysely as KyselyCtor, MysqlDialect } from 'kysely';
import { createPool, type Pool } from 'mysql2';

export interface KyselyClient<DB> {
  db: Kysely<DB>;
  close: () => Promise<void>;
}

export interface KyselyClientOptions {
  /**
   * MySQL pool size (max connections this client holds open).
   *
   * Budget: replicas × modules × poolSize ≤ MySQL max_connections × 0.6.
   * (docker/mysql/conf.d/innodb.cnf sets max_connections=200; default is 151.)
   * Default 5: 2 modules × 10 instances × 5 = 100 connections, leaves
   * headroom for cron / migrate / ops.
   *
   * Threaded in from `kysely.module.ts` via `ConfigService.get('DB_POOL_SIZE')`.
   * `env.schema.ts` validates the range [1, 50]; the factory trusts that
   * contract and does no further bounding.
   */
  poolSize?: number;
}

/**
 * Generic factory: each module instantiates its own client against its own
 * DATABASE_URL with its own typed Database interface.
 *
 * `maintainNestedObjectKeys: true` is critical — without it, the CamelCasePlugin
 * recursively rewrites JSON column object keys on SELECT and corrupts e.g. the
 * EventMap shape stored in _template_configs.events.
 */
export function createKyselyClient<DB>(
  databaseUrl: string,
  opts: KyselyClientOptions = {},
): KyselyClient<DB> {
  const poolSize = opts.poolSize ?? 5;

  const pool: Pool = createPool({
    uri: databaseUrl,
    connectionLimit: poolSize,
    // `queueLimit` bounds how many awaiters can pile up on connection acquire —
    // beyond this, mysql2 rejects with ER_CON_COUNT_ERROR rather than queuing
    // forever. `connectTimeout` bounds the initial TCP handshake. Without
    // these, a degraded DB will accept new HTTP requests that never resolve.
    queueLimit: poolSize * 4,
    connectTimeout: 5000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: 'Z',
    // `decimalNumbers: true` would coerce DECIMAL columns to JS Number — silent
    // precision loss past 2^53. We have no DECIMAL columns today, but the option
    // applies retroactively when one is added. Leave it off; convert at the
    // boundary using a money lib (e.g. dinero.js) if and when needed.
  });
  const db = new KyselyCtor<DB>({
    dialect: new MysqlDialect({ pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });
  return {
    db,
    close: async () => {
      await db.destroy();
    },
  };
}
