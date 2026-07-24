import type { KyselyClient } from '../../../../../src/core/db/kysely-factory';
import type { LoyaltyDatabase } from '../../../../../src/modules/loyalty/db/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * In-memory Kysely stand-in for the QR / customers / dashboard verticals.
 * Implements exactly the query-builder subset those controllers/services use:
 *
 *   selectFrom(t).selectAll()/.select(cols | (eb) => eb.fn.countAll().as(n))
 *     .innerJoin(...)/.groupBy(col)
 *     .where(f, '='|'>'|'<'|'>='|'<='|'is'|'is not', v).orderBy(f, dir)
 *     .limit(n).offset(n).execute()/.executeTakeFirst()
 *   insertInto(t).values(v).ignore().executeTakeFirst()
 *     — honors the real unique keys ((merchantId,phone), (qrCodeId,phone),
 *       qr id/code) and returns `numInsertedOrUpdatedRows` like the MySQL
 *       dialect, so INSERT-IGNORE one-scan-per-phone tests are real.
 *   updateTable(t).set(obj | (eb) => ({ col: eb(col, '+', n) }))
 *     .where(...).execute() — atomic-increment expressions supported.
 *   deleteFrom(t).where(...).execute()
 */

type Row = Record<string, any>;
type Where = [field: string, op: string, value: any];

const UNIQUE_KEYS: Record<string, string[][]> = {
  loyalty_customers: [['merchantId', 'phone']],
  loyalty_qr_scans: [['qrCodeId', 'phone']],
  loyalty_qr_codes: [['id'], ['code']],
  loyalty_daily_stats: [['merchantId', 'statDate']],
};

function rowMatches(row: Row, wheres: Where[]): boolean {
  return wheres.every(([f, op, v]) => {
    const field = f.includes('.') ? f.split('.')[1] : f;
    if (op === '=') return row[field] === v;
    if (op === '>') return row[field] > v;
    if (op === '<') return row[field] < v;
    if (op === '>=') return row[field] >= v;
    if (op === '<=') return row[field] <= v;
    if (op === 'is') return row[field] === v || (v === null && row[field] == null);
    if (op === 'is not') return v === null && row[field] != null;
    throw new Error(`FakeQrDb: unsupported where operator '${op}'`);
  });
}

export class FakeQrDb {
  readonly tables: Record<string, Row[]> = {};
  private autoId = 0;

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  seed(name: string, rows: Row[]): void {
    this.table(name).push(...rows.map((r) => ({ ...this.withDefaults(name, r) })));
  }

  private withDefaults(table: string, v: Row): Row {
    const now = new Date();
    if (table === 'loyalty_customers') {
      return {
        name: null,
        email: null,
        pointsBalance: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0,
        lifetimeExpired: 0,
        lifetimeAdjusted: 0,
        lifetimeSpend: '0.00',
        lifetimeOrders: 0,
        lastOrderAt: null,
        firstSeenSource: 'order',
        balanceSyncedAt: null,
        createdAt: now,
        updatedAt: now,
        ...v,
      };
    }
    if (table === 'loyalty_qr_codes') {
      return {
        maxScans: 0,
        claimMessage: null,
        status: 'ACTIVE',
        scanCount: 0,
        newPhoneCount: 0,
        createdAt: now,
        updatedAt: now,
        ...v,
      };
    }
    if (table === 'loyalty_qr_scans') {
      return {
        id: ++this.autoId,
        isNewPhone: false,
        coreTransactionId: null,
        convertedOrderId: null,
        convertedAt: null,
        scannedAt: now,
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
        let group: string | null = null;
        let cols: string[] | null = null;
        const eb: any = {
          fn: {
            countAll: () => ({
              as: (name: string) => {
                agg = name;
                return { __agg: name };
              },
            }),
          },
        };
        const chain: any = {
          selectAll: () => chain,
          innerJoin: () => chain,
          select: (arg: unknown) => {
            if (typeof arg === 'function') {
              arg(eb);
            } else if (Array.isArray(arg)) {
              cols = [...(cols ?? []), ...(arg as string[])];
            } else if (typeof arg === 'string') {
              cols = [...(cols ?? []), arg];
            }
            return chain;
          },
          groupBy: (col: string) => {
            group = col.includes('.') ? col.split('.')[1] : col;
            return chain;
          },
          where: (f: unknown, op?: string, v?: unknown) => {
            if (typeof f === 'function') {
              // Expression-builder callback (exists/or) — evaluate against a
              // recording stub is out of scope; treat as match-all.
              return chain;
            }
            wheres.push([f as string, op as string, v]);
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
            if (agg && group) {
              const g = group;
              const counts = new Map<unknown, number>();
              for (const r of rows) counts.set(r[g], (counts.get(r[g]) ?? 0) + 1);
              return Promise.resolve(
                [...counts.entries()].map(([k, n]) => ({ [g]: k, [agg as string]: n })),
              );
            }
            if (agg) return Promise.resolve([{ [agg]: rows.length }]);
            if (order) {
              const [f, dir] = order;
              rows = [...rows].sort((a, b) => {
                const cmp = a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0;
                return dir === 'desc' ? -cmp : cmp;
              });
            }
            if (off || lim !== null) rows = rows.slice(off, lim !== null ? off + lim : undefined);
            if (cols) {
              const picked = cols.map((c) => (c.includes('.') ? c.split('.')[1] : c));
              return Promise.resolve(
                rows.map((r) => Object.fromEntries(picked.map((c) => [c, r[c]]))),
              );
            }
            return Promise.resolve(rows.map((r) => ({ ...r })));
          },
          executeTakeFirst: async () => (await chain.execute())[0],
        };
        return chain;
      },

      insertInto(table: string) {
        let vals: Row[] = [];
        let ignore = false;
        let odku: Row | null = null;
        const run = () => {
          const rows = self.table(table);
          let inserted = 0;
          for (const v of vals) {
            const existing = (UNIQUE_KEYS[table] ?? [])
              .map((colSet) => rows.find((ex) => colSet.every((c) => ex[c] === v[c])))
              .find((r) => r !== undefined);
            if (existing) {
              if (ignore) continue;
              if (odku) {
                Object.assign(existing, odku);
                continue;
              }
              throw new Error(`FakeQrDb: duplicate key in ${table}`);
            }
            rows.push(self.withDefaults(table, v));
            inserted += 1;
          }
          return {
            insertId: BigInt(self.autoId),
            numInsertedRows: BigInt(inserted),
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
          onDuplicateKeyUpdate: (u: Row) => {
            odku = u;
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

      deleteFrom(table: string) {
        const wheres: Where[] = [];
        const chain: any = {
          where: (f: string, op: string, v: unknown) => {
            wheres.push([f, op, v]);
            return chain;
          },
          execute: () => {
            const rows = self.table(table);
            const keep = rows.filter((r) => !rowMatches(r, wheres));
            const n = rows.length - keep.length;
            self.tables[table] = keep;
            return Promise.resolve([{ numDeletedRows: BigInt(n) }]);
          },
        };
        return chain;
      },
    };
  }
}

export function makeFakeQrHandle(): { fake: FakeQrDb; handle: KyselyClient<LoyaltyDatabase> } {
  const fake = new FakeQrDb();
  const handle = {
    db: fake.db,
    close: () => Promise.resolve(),
  } as unknown as KyselyClient<LoyaltyDatabase>;
  return { fake, handle };
}
