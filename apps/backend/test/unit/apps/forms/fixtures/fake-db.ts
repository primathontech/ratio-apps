import type { KyselyClient } from '../../../../../src/core/db/kysely-factory';
import type { FormsDatabase } from '../../../../../src/modules/forms/db/types';

// biome-ignore lint/suspicious/noExplicitAny: test fake works on loose rows
export type Row = Record<string, any>;
type Where = [string, string, unknown];

export interface FakeHandle {
  handle: KyselyClient<FormsDatabase>;
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; values: Row }>;
  updates: Array<{ table: string; set: Row; wheres: Where[] }>;
}

const toComparable = (v: unknown): number | string => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return String(v);
};

/**
 * In-memory mini-Kysely covering exactly the chains the forms part-2
 * services use: filtered selects (`=`, `is`, `in`, `<=`), orderBy / limit /
 * offset, inserts (with the real UNIQUE `idempotency_key` collision on
 * `form_submissions` surfaced as ER_DUP_ENTRY), and conditional updates
 * (rows-affected reported via `numUpdatedRows`; `sql` expressions in `set`
 * are applied as `new Date()` like `CURRENT_TIMESTAMP(3)` would be).
 */
export function makeFakeHandle(seed: Record<string, Row[]> = {}): FakeHandle {
  const tables: Record<string, Row[]> = {
    forms: [],
    forms_configs: [],
    form_submissions: [],
    form_webhook_deliveries: [],
    form_email_log: [],
    form_export_jobs: [],
    ...seed,
  };
  const inserts: Array<{ table: string; values: Row }> = [];
  const updates: Array<{ table: string; set: Row; wheres: Where[] }> = [];

  /** A single-column comparison, shared by direct wheres and `eb(...)` leaves. */
  const leaf = (row: Row, column: string, op: string, value: unknown): boolean => {
    if (op === '=') {
      // Real MySQL compares DATETIME by value; two distinct Date objects with
      // the same instant are equal (keyset tiebreaker relies on this).
      if (row[column] instanceof Date || value instanceof Date) {
        return (
          row[column] != null && value != null && toComparable(row[column]) === toComparable(value)
        );
      }
      return row[column] === value;
    }
    if (op === 'is') return value === null ? row[column] == null : row[column] === value;
    if (op === 'in') return (value as unknown[]).includes(row[column]);
    const a = row[column];
    if (op === '<=') return a != null && toComparable(a) <= toComparable(value);
    if (op === '>=') return a != null && toComparable(a) >= toComparable(value);
    if (op === '<') return a != null && toComparable(a) < toComparable(value);
    if (op === '>') return a != null && toComparable(a) > toComparable(value);
    throw new Error(`fake db: unsupported operator ${op}`);
  };

  /** Predicate node returned by the mini expression builder (`eb`). */
  interface Pred {
    __pred: (row: Row) => boolean;
  }
  // biome-ignore lint/suspicious/noExplicitAny: mini expression builder
  const eb: any = (column: string, op: string, value: unknown): Pred => ({
    __pred: (row: Row) => leaf(row, column, op, value),
  });
  eb.or = (preds: Pred[]): Pred => ({ __pred: (row: Row) => preds.some((p) => p.__pred(row)) });
  eb.and = (preds: Pred[]): Pred => ({ __pred: (row: Row) => preds.every((p) => p.__pred(row)) });

  const matches = (row: Row, wheres: Where[]): boolean =>
    wheres.every(([column, op, value]) => {
      // Keyset export uses a `.where((eb) => ...)` callback — stored as an
      // opaque predicate function under the `__expr` marker.
      if (op === '__expr') return (value as (r: Row) => boolean)(row);
      return leaf(row, column, op, value);
    });

  const isSqlExpression = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);

  const db = {
    selectFrom(table: string) {
      const state = {
        wheres: [] as Where[],
        orders: [] as Array<[string, string]>,
        limit: undefined as number | undefined,
        offset: 0,
      };
      // biome-ignore lint/suspicious/noExplicitAny: chain fake
      const chain: any = {
        selectAll: () => chain,
        select: () => chain,
        // Accepts both `.where(column, op, value)` and the keyset export's
        // `.where((eb) => eb.or([...]))` expression-builder callback.
        where: (column: string | ((builder: unknown) => Pred), op?: string, value?: unknown) => {
          if (typeof column === 'function') {
            const pred = column(eb);
            state.wheres.push(['__expr', '__expr', (row: Row) => pred.__pred(row)]);
          } else {
            state.wheres.push([column, op as string, value]);
          }
          return chain;
        },
        orderBy: (column: string, dir: string) => {
          state.orders.push([column, dir]);
          return chain;
        },
        limit: (n: number) => {
          state.limit = n;
          return chain;
        },
        offset: (n: number) => {
          state.offset = n;
          return chain;
        },
        execute: async () => {
          let rows = (tables[table] ?? []).filter((r) => matches(r, state.wheres));
          if (state.orders.length) {
            rows = [...rows].sort((a, b) => {
              for (const [column, dir] of state.orders) {
                const av = toComparable(a[column]);
                const bv = toComparable(b[column]);
                const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
              }
              return 0;
            });
          }
          return rows.slice(state.offset, state.limit ? state.offset + state.limit : undefined);
        },
        executeTakeFirst: async () => (await chain.execute())[0],
      };
      return chain;
    },

    insertInto(table: string) {
      return {
        values(values: Row) {
          return {
            execute: async () => {
              // Mirror the real UNIQUE(idempotency_key) column (PRD F10).
              if (
                table === 'form_submissions' &&
                values.idempotencyKey !== undefined &&
                (tables[table] ?? []).some((r) => r.idempotencyKey === values.idempotencyKey)
              ) {
                const err = new Error('Duplicate entry') as Error & {
                  code: string;
                  errno: number;
                };
                err.code = 'ER_DUP_ENTRY';
                err.errno = 1062;
                throw err;
              }
              const row = { createdAt: new Date(), updatedAt: new Date(), ...values };
              if (row.id === undefined) {
                row.id = ((tables[table] ?? []).length + 1) as unknown as Row['id'];
              }
              inserts.push({ table, values: row });
              if (!tables[table]) tables[table] = [];
              tables[table].push(row);
              return [];
            },
          };
        },
      };
    },

    // Minimal `db.transaction().execute(cb)`: runs `cb` against the same db and
    // rolls back appended rows if it throws (this fake's transactions only
    // insert), so an atomic insert + enqueue that fails midway leaves nothing.
    transaction() {
      return {
        // biome-ignore lint/suspicious/noExplicitAny: mirrors kysely's trx cb
        execute: async (cb: (trx: any) => Promise<unknown>) => {
          const tableLengths = new Map(Object.keys(tables).map((t) => [t, tables[t].length]));
          const insertsLen = inserts.length;
          try {
            return await cb(db);
          } catch (err) {
            for (const [t, len] of tableLengths) tables[t].length = len;
            inserts.length = insertsLen;
            throw err;
          }
        },
      };
    },

    updateTable(table: string) {
      const state = { set: {} as Row, wheres: [] as Where[] };
      // biome-ignore lint/suspicious/noExplicitAny: chain fake
      const chain: any = {
        set: (values: Row) => {
          state.set = values;
          return chain;
        },
        where: (column: string, op: string, value: unknown) => {
          state.wheres.push([column, op, value]);
          return chain;
        },
        execute: async () => {
          await chain.executeTakeFirst();
          return [];
        },
        executeTakeFirst: async () => {
          const rows = (tables[table] ?? []).filter((r) => matches(r, state.wheres));
          for (const row of rows) {
            for (const [key, value] of Object.entries(state.set)) {
              row[key] = isSqlExpression(value) ? new Date() : value;
            }
          }
          updates.push({ table, set: state.set, wheres: state.wheres });
          return { numUpdatedRows: BigInt(rows.length) };
        },
      };
      return chain;
    },
  };

  return {
    handle: { db } as unknown as KyselyClient<FormsDatabase>,
    tables,
    inserts,
    updates,
  };
}
