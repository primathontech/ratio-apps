import { MysqlQueryCompiler } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { FbtAppUninstalledHandler } from '../../../../src/modules/fbt/webhooks/app-uninstalled.handler';
import { FBT_TOPICS } from '../../../../src/modules/fbt/webhooks/topics';

/**
 * `trx` double covering the handler's three operations: a raw SELECT ... FOR
 * UPDATE, a selectFrom read, and an updateTable write.
 *
 * IMPORTANT — the shape here is not obvious and two earlier drafts of this plan got
 * it wrong. Kysely's `sql`…`.execute(provider)` does NOT call `executeQuery` on the
 * object you hand it. `RawBuilder.execute` calls `provider.getExecutor()`, then that
 * executor's `transformQuery` → `compileQuery` → `executeQuery`. A double carrying
 * only `executeQuery` fails with `executorProvider.getExecutor is not a function`.
 *
 * Wiring the real `MysqlQueryCompiler` into the fake executor costs one import and
 * makes `recordedSql` hold the GENUINE compiled statement — which lets the test
 * assert the `FOR UPDATE` lock is actually taken, and that `merchantId` is bound as
 * a parameter rather than interpolated into the SQL text. That lock is this
 * handler's subtlest and most load-bearing behaviour: it serialises against an
 * in-flight OAuth callback so a reinstall cannot race the uninstall into an
 * inconsistent `isActive`. Verified: the compiler emits
 * `SELECT id FROM merchants WHERE id = ? FOR UPDATE` with `['merch-1']`.
 */
function fakeTrx(merchantRow: { id: string; isActive: boolean } | undefined) {
  const updates: Array<Record<string, unknown>> = [];
  const recordedSql: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const compiler = new MysqlQueryCompiler();

  const executor = {
    transformQuery: (node: unknown) => node,
    // biome-ignore lint/suspicious/noExplicitAny: Kysely's operation-node types are internal
    compileQuery: (node: any) => compiler.compileQuery(node),
    executeQuery: async (compiled: { sql: string; parameters: readonly unknown[] }) => {
      recordedSql.push({ sql: compiled.sql, parameters: compiled.parameters });
      return { rows: merchantRow ? [{ id: merchantRow.id }] : [] };
    },
  };

  const trx = {
    getExecutor: () => executor,
    selectFrom() {
      return {
        selectAll() {
          return this;
        },
        where() {
          return this;
        },
        limit() {
          return this;
        },
        async executeTakeFirst() {
          return merchantRow;
        },
      };
    },
    updateTable() {
      return {
        set(values: Record<string, unknown>) {
          updates.push(values);
          return this;
        },
        where() {
          return this;
        },
        async execute() {
          return [];
        },
      };
    },
    // biome-ignore lint/suspicious/noExplicitAny: test double
  } as any;
  return { trx, updates, recordedSql };
}

describe('FbtAppUninstalledHandler', () => {
  const handler = () => new FbtAppUninstalledHandler({ findById: vi.fn() } as never);

  it('subscribes to the app.uninstalled topic', () => {
    expect(handler().topic).toBe(FBT_TOPICS.APP_UNINSTALLED);
  });

  it('deactivates an active merchant', async () => {
    const { trx, updates } = fakeTrx({ id: 'merch-1', isActive: true });
    await handler().handle({}, 'merch-1', trx);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.isActive).toBe(false);
    expect(updates[0]?.uninstalledAt).toBeDefined();
  });

  it('is a no-op for an already-inactive merchant (webhook retry)', async () => {
    const { trx, updates } = fakeTrx({ id: 'merch-1', isActive: false });
    await handler().handle({}, 'merch-1', trx);

    expect(updates).toHaveLength(0);
  });

  it('is a no-op for an unknown merchant', async () => {
    const { trx, updates } = fakeTrx(undefined);
    await handler().handle({}, 'merch-1', trx);

    expect(updates).toHaveLength(0);
  });

  it('is a no-op when merchantId is null', async () => {
    const { trx, updates } = fakeTrx({ id: 'merch-1', isActive: true });
    await handler().handle({}, null, trx);

    expect(updates).toHaveLength(0);
  });

  // The two cases below cover the handler's least obvious behaviour. The
  // SELECT … FOR UPDATE serialises against an in-flight OAuth callback, which also
  // takes a row lock on `merchants.id` before its upsert. Without it, a callback
  // could re-INSERT `isActive = true` AFTER this handler's existence check but
  // BEFORE its UPDATE, leaving Ratio (uninstalled) and the DB (active) out of sync.
  // Nothing previously tested that the lock is taken at all.
  it('takes a FOR UPDATE lock on the merchant row before reading it', async () => {
    const { trx, recordedSql } = fakeTrx({ id: 'merch-1', isActive: true });
    await handler().handle({}, 'merch-1', trx);

    expect(recordedSql).toHaveLength(1);
    expect(recordedSql[0]?.sql).toMatch(/FOR UPDATE/i);
  });

  it('binds merchantId as a parameter rather than interpolating it', async () => {
    const { trx, recordedSql } = fakeTrx({ id: 'merch-1', isActive: true });
    await handler().handle({}, 'merch-1', trx);

    expect(recordedSql[0]?.parameters).toEqual(['merch-1']);
    expect(recordedSql[0]?.sql).not.toContain('merch-1');
  });
});
