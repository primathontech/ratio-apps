import type { LoyaltyCustomerFilters } from '@ratio-app/shared/schemas/loyalty-export';
import type { KyselyClient } from '../../../../../src/core/db/kysely-factory';
import type {
  LoyaltyCustomerRow,
  LoyaltyDatabase,
} from '../../../../../src/modules/loyalty/db/types';
import type {
  CustomerQuery,
  LoyaltyCustomerSort,
} from '../../../../../src/modules/loyalty/mirror/customer-query.types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * In-memory Kysely stand-in for the loyalty bulk/exports tables. Implements
 * exactly the query-builder subset the bulk/exports services + workers use:
 *
 *   selectFrom(t).selectAll()/.select(cols | eb.fn.countAll())
 *     .where(f, '='|'in', v).orderBy(f, dir).limit(n).offset(n)
 *     .execute()/.executeTakeFirst()
 *   insertInto(t).values(v | v[]).ignore().execute()/.executeTakeFirst()
 *     — honors the real unique keys (op PK, (operationId,rowNumber), export PK)
 *       so `.ignore()` retry-idempotency tests are real; returns
 *       `numInsertedOrUpdatedRows` like Kysely's MySQL dialect `InsertResult`.
 *   updateTable(t).set(obj | (eb) => ({ col: eb(col, '+', n) }))
 *     .where(...).execute() — atomic-increment expressions supported.
 */

type Row = Record<string, any>;
type Where = [field: string, op: string, value: any];

const UNIQUE_KEYS: Record<string, string[][]> = {
  loyalty_bulk_operations: [['id']],
  loyalty_bulk_operation_rows: [['operationId', 'rowNumber']],
  loyalty_exports: [['id']],
};

function rowMatches(row: Row, wheres: Where[]): boolean {
  return wheres.every(([f, op, v]) => {
    if (op === '=') return row[f] === v;
    if (op === 'in') return Array.isArray(v) && v.includes(row[f]);
    if (op === '<') return row[f] < v;
    if (op === '>') return row[f] > v;
    throw new Error(`FakeLoyaltyDb: unsupported where operator '${op}'`);
  });
}

export class FakeLoyaltyDb {
  readonly tables: Record<string, Row[]> = {};
  private autoId = 0;

  table(name: string): Row[] {
    this.tables[name] ??= [];
    return this.tables[name];
  }

  private withDefaults(table: string, v: Row): Row {
    const now = new Date();
    if (table === 'loyalty_bulk_operation_rows') {
      return {
        id: ++this.autoId,
        reason: null,
        status: 'pending',
        errorReason: null,
        coreTransactionId: null,
        processedAt: null,
        ...v,
      };
    }
    if (table === 'loyalty_bulk_operations') {
      return {
        status: 'validating',
        fileName: null,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        processedRows: 0,
        successCount: 0,
        failureCount: 0,
        totalPoints: 0,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        ...v,
      };
    }
    if (table === 'loyalty_exports') {
      return {
        status: 'pending',
        rowCount: null,
        s3Key: null,
        email: null,
        emailedAt: null,
        createdBy: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        ...v,
      };
    }
    return { ...v };
  }

  /** The `handle.db` facade the services receive. */
  get db(): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      selectFrom(table: string) {
        const wheres: Where[] = [];
        let order: [string, 'asc' | 'desc'] | null = null;
        let lim: number | null = null;
        let off = 0;
        let agg: string | null = null;
        const chain: any = {
          selectAll: () => chain,
          select: (arg: unknown) => {
            if (typeof arg === 'function') {
              const eb = {
                fn: {
                  countAll: () => ({
                    as: (name: string) => {
                      agg = name;
                      return { __agg: name };
                    },
                  }),
                },
              };
              arg(eb);
            }
            return chain;
          },
          where: (f: string, op: string, v: unknown) => {
            wheres.push([f, op, v]);
            return chain;
          },
          orderBy: (f: string, dir: 'asc' | 'desc' = 'asc') => {
            order = [f, dir];
            return chain;
          },
          limit: (n: number) => {
            lim = n;
            return chain;
          },
          offset: (n: number) => {
            off = n;
            return chain;
          },
          execute: () => {
            let rows = self.table(table).filter((r) => rowMatches(r, wheres));
            if (agg) return Promise.resolve([{ [agg]: rows.length }]);
            if (order) {
              const [f, dir] = order;
              rows = [...rows].sort((a, b) => {
                const av = a[f];
                const bv = b[f];
                const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                return dir === 'desc' ? -cmp : cmp;
              });
            }
            if (off || lim !== null) rows = rows.slice(off, lim !== null ? off + lim : undefined);
            return Promise.resolve(rows.map((r) => ({ ...r })));
          },
          executeTakeFirst: async () => (await chain.execute())[0],
        };
        return chain;
      },

      insertInto(table: string) {
        let vals: Row[] = [];
        let ignore = false;
        const run = () => {
          const rows = self.table(table);
          let inserted = 0;
          for (const v of vals) {
            const conflict = (UNIQUE_KEYS[table] ?? []).some((cols) =>
              rows.some((ex) => cols.every((c) => ex[c] === v[c])),
            );
            if (conflict) {
              if (ignore) continue;
              throw new Error(`FakeLoyaltyDb: duplicate key in ${table}`);
            }
            rows.push(self.withDefaults(table, v));
            inserted += 1;
          }
          return {
            insertId: BigInt(self.autoId),
            numInsertedOrUpdatedRows: BigInt(inserted),
          };
        };
        const chain: any = {
          values: (v: Row | Row[]) => {
            vals = Array.isArray(v) ? v : [v];
            return chain;
          },
          ignore: () => {
            ignore = true;
            return chain;
          },
          execute: () => Promise.resolve([run()]),
          executeTakeFirst: () => Promise.resolve(run()),
        };
        return chain;
      },

      updateTable(table: string) {
        const wheres: Where[] = [];
        let setter: any = null;
        // eb is callable: eb('col', '+', n) → increment expression marker.
        const eb: any = (col: string, op: string, val: number) => ({ __expr: true, col, op, val });
        const chain: any = {
          set: (s: unknown) => {
            setter = s;
            return chain;
          },
          where: (f: string, op: string, v: unknown) => {
            wheres.push([f, op, v]);
            return chain;
          },
          execute: () => {
            let n = 0;
            for (const r of self.table(table)) {
              if (!rowMatches(r, wheres)) continue;
              n += 1;
              const s = typeof setter === 'function' ? setter(eb) : setter;
              for (const [k, v] of Object.entries(s as Row)) {
                if (v && typeof v === 'object' && (v as any).__expr) {
                  const e = v as { col: string; op: string; val: number };
                  r[k] = e.op === '+' ? r[e.col] + e.val : r[e.col] - e.val;
                } else {
                  r[k] = v;
                }
              }
            }
            return Promise.resolve([{ numUpdatedRows: BigInt(n) }]);
          },
        };
        return chain;
      },
    };
  }
}

export function makeFakeLoyaltyHandle(): {
  fake: FakeLoyaltyDb;
  handle: KyselyClient<LoyaltyDatabase>;
} {
  const fake = new FakeLoyaltyDb();
  const handle = {
    db: fake.db,
    close: () => Promise.resolve(),
  } as unknown as KyselyClient<LoyaltyDatabase>;
  return { fake, handle };
}

// ── CustomerQuery fake (mirror vertical contract, in-memory) ────────────────

export class FakeCustomerQuery implements CustomerQuery {
  /** When set, `count()` returns this instead of `rows.length`. */
  countValue: number | null = null;

  constructor(public rows: LoyaltyCustomerRow[] = []) {}

  count(_merchantId: string, _filters: LoyaltyCustomerFilters): Promise<number> {
    return Promise.resolve(this.countValue ?? this.rows.length);
  }

  page(
    _merchantId: string,
    _filters: LoyaltyCustomerFilters,
    opts: { page: number; limit: number; sort: LoyaltyCustomerSort },
  ): Promise<{ rows: LoyaltyCustomerRow[]; total: number }> {
    const start = (opts.page - 1) * opts.limit;
    return Promise.resolve({
      rows: this.rows.slice(start, start + opts.limit),
      total: this.rows.length,
    });
  }

  async *streamAll(
    _merchantId: string,
    _filters: LoyaltyCustomerFilters,
    maxRows: number,
  ): AsyncIterable<LoyaltyCustomerRow> {
    for (const row of this.rows.slice(0, maxRows)) yield row;
  }
}
