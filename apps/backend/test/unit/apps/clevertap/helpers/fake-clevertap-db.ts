import type { KyselyClient } from '../../../../../src/core/db/kysely-factory';
import type { ClevertapDatabase } from '../../../../../src/modules/clevertap/db/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;
type Where = [field: string, op: string, value: any];

const UNIQUE_KEYS: Record<string, string[][]> = {
  merchants: [['id']],
  oauth_tokens: [['merchantId']],
  clevertap_configs: [['merchantId']],
  clevertap_forwarded_events: [['id'], ['merchantId', 'idempotencyKey']],
  webhook_log: [['id'], ['ratioWebhookId']],
};

const JSON_COLUMNS: Record<string, string[]> = {
  clevertap_configs: ['events'],
  webhook_log: ['payload'],
};

export class FakeDuplicateKeyError extends Error {
  readonly code = 'ER_DUP_ENTRY';
  readonly errno = 1062;
  readonly sqlState = '23000';
  constructor(table: string, cols: string[]) {
    super(`Duplicate entry for key '${table}.${cols.join('_')}'`);
    this.name = 'FakeDuplicateKeyError';
  }
}

function isRawFragment(v: unknown): boolean {
  return typeof v === 'object' && v !== null && typeof (v as any).as === 'function';
}

function rowMatches(row: Row, wheres: Where[]): boolean {
  return wheres.every(([f, op, v]) => {
    const cell = row[f];
    switch (op) {
      case '=':
        return cell === v;
      case '!=':
      case '<>':
        return cell !== v;
      case 'in':
        return Array.isArray(v) && v.includes(cell);
      case 'is':
        return v === null ? cell === null || cell === undefined : cell === v;
      case 'is not':
        return v === null ? cell !== null && cell !== undefined : cell !== v;
      case '<':
        return cell < v;
      case '<=':
        return cell <= v;
      case '>':
        return cell > v;
      case '>=':
        return cell >= v;
      default:
        throw new Error(`FakeClevertapDb: unsupported where operator '${op}'`);
    }
  });
}

export class FakeClevertapDb {
  readonly tables: Record<string, Row[]> = {};
  readonly inserts: { table: string; values: Row }[] = [];
  readonly forUpdateCalls: string[] = [];
  inTransaction = false;
  private uuidSeq = 0;

  table(name: string): Row[] {
    this.tables[name] ??= [];
    return this.tables[name];
  }

  seed(table: string, ...rows: Row[]): this {
    this.table(table).push(...rows.map((r) => ({ ...r })));
    return this;
  }

  private nextUuid(): string {
    this.uuidSeq += 1;
    return `00000000-0000-4000-8000-${String(this.uuidSeq).padStart(12, '0')}`;
  }

  private withDefaults(table: string, v: Row): Row {
    const now = new Date();
    const row: Row = { ...v };

    for (const col of JSON_COLUMNS[table] ?? []) {
      if (typeof row[col] === 'string') {
        row[col] = JSON.parse(row[col]);
      }
    }

    if (table === 'merchants') {
      return {
        isActive: true,
        installedAt: now,
        uninstalledAt: null,
        createdAt: now,
        updatedAt: now,
        ...row,
      };
    }
    if (table === 'clevertap_configs') {
      return {
        accountId: '',
        passcodeEnc: null,
        region: 'in1',
        serverEventsEnabled: false,
        debug: false,
        createdAt: now,
        updatedAt: now,
        ...row,
      };
    }
    if (table === 'clevertap_forwarded_events') {
      return {
        id: this.nextUuid(),
        error: null,
        sentAt: now,
        ...row,
      };
    }
    if (table === 'webhook_log') {
      return {
        id: this.nextUuid(),
        merchantId: null,
        processedAt: null,
        receivedAt: now,
        ...row,
      };
    }
    return row;
  }

  private findConflict(table: string, v: Row): { row: Row; cols: string[] } | null {
    for (const cols of UNIQUE_KEYS[table] ?? []) {
      if (cols.some((c) => v[c] === undefined)) continue;
      const row = this.table(table).find((ex) => cols.every((c) => ex[c] === v[c]));
      if (row) return { row, cols };
    }
    return null;
  }

  get db(): any {
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
              const mkAgg = () => ({
                as: (name: string) => {
                  agg = name;
                  return { __agg: name };
                },
              });
              (arg as (eb: unknown) => unknown)({
                fn: { countAll: mkAgg, count: mkAgg, sum: mkAgg },
              });
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
          forUpdate: () => {
            self.forUpdateCalls.push(table);
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
          executeTakeFirstOrThrow: async () => {
            const first = (await chain.execute())[0];
            if (!first) throw new Error(`FakeClevertapDb: no row in ${table}`);
            return first;
          },
        };
        return chain;
      },

      insertInto(table: string) {
        let vals: Row[] = [];
        let ignore = false;
        let odku: Row | null = null;
        const run = () => {
          let affected = 0;
          for (const v of vals) {
            self.inserts.push({ table, values: { ...v } });
            const conflict = self.findConflict(table, v);
            if (conflict) {
              if (odku) {
                const decoded = self.withDefaults(table, odku);
                let applied = 0;
                for (const [k, val] of Object.entries(odku)) {
                  if (isRawFragment(val)) continue;
                  conflict.row[k] = decoded[k];
                  applied += 1;
                }
                if (applied > 0) {
                  conflict.row.updatedAt = new Date();
                  affected += 2;
                }
                continue;
              }
              if (ignore) continue;
              throw new FakeDuplicateKeyError(table, conflict.cols);
            }
            self.table(table).push(self.withDefaults(table, v));
            affected += 1;
          }
          return {
            insertId: BigInt(0),
            numInsertedOrUpdatedRows: BigInt(affected),
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
          onDuplicateKeyUpdate: (set: Row) => {
            odku = set;
            return chain;
          },
          execute: () => Promise.resolve([run()]),
          executeTakeFirst: () => Promise.resolve(run()),
        };
        return chain;
      },

      updateTable(table: string) {
        const wheres: Where[] = [];
        let setter: Row | ((eb: unknown) => Row) | null = null;
        const eb: any = (col: string, op: string, val: number) => ({ __expr: true, col, op, val });
        const chain: any = {
          set: (s: Row | ((eb: unknown) => Row)) => {
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
              const s = typeof setter === 'function' ? setter(eb) : (setter ?? {});
              for (const [k, v] of Object.entries(s)) {
                if (isRawFragment(v)) continue;
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
          executeTakeFirst: async () => (await chain.execute())[0],
        };
        return chain;
      },

      deleteFrom(table: string) {
        const wheres: Where[] = [];
        const chain: any = {
          where: (f: string, op: string, v: unknown) => {
            wheres.push([f, op, v]);
            return chain;
          },
          execute: () => {
            const rows = self.table(table);
            let n = 0;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rowMatches(rows[i], wheres)) {
                rows.splice(i, 1);
                n += 1;
              }
            }
            return Promise.resolve([{ numDeletedRows: BigInt(n) }]);
          },
        };
        return chain;
      },

      transaction() {
        return {
          execute: async <T>(cb: (trx: unknown) => Promise<T>): Promise<T> => {
            self.inTransaction = true;
            try {
              return await cb(self.db);
            } finally {
              self.inTransaction = false;
            }
          },
        };
      },
    };
  }

  config(merchantId: string): Row | undefined {
    return this.table('clevertap_configs').find((r) => r.merchantId === merchantId);
  }

  forwarded(merchantId: string): Row[] {
    return this.table('clevertap_forwarded_events').filter((r) => r.merchantId === merchantId);
  }
}

export function makeFakeClevertapHandle(): {
  fake: FakeClevertapDb;
  handle: KyselyClient<ClevertapDatabase>;
} {
  const fake = new FakeClevertapDb();
  const handle = {
    db: fake.db,
    close: () => Promise.resolve(),
  } as unknown as KyselyClient<ClevertapDatabase>;
  return { fake, handle };
}
