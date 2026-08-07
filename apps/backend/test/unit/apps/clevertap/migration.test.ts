import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../../../../src/modules/clevertap/db/migrations/0001_initial';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ColumnSpec {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
}

interface FkSpec {
  name: string;
  columns: string[];
  targetTable: string;
  targetColumns: string[];
  onDelete: string | null;
}

interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  fks: FkSpec[];
}

interface IndexSpec {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
}

function makeSchemaRecorder() {
  const tables: TableSpec[] = [];
  const indexes: IndexSpec[] = [];
  const dropped: string[] = [];

  const columnBuilder = (c: ColumnSpec) => {
    const b: any = {
      notNull: () => {
        c.notNull = true;
        return b;
      },
      primaryKey: () => {
        c.primaryKey = true;
        return b;
      },
      unique: () => {
        c.unique = true;
        return b;
      },
      defaultTo: (v: unknown) => {
        c.hasDefault = true;
        c.defaultValue = v;
        return b;
      },
      references: () => b,
      onDelete: () => b,
    };
    return b;
  };

  const schema: any = {
    createTable(name: string) {
      const spec: TableSpec = { name, columns: [], fks: [] };
      const b: any = {
        addColumn(col: string, type: string, cb?: (c: any) => unknown) {
          const c: ColumnSpec = {
            name: col,
            type,
            notNull: false,
            primaryKey: false,
            unique: false,
            hasDefault: false,
          };
          cb?.(columnBuilder(c));
          spec.columns.push(c);
          return b;
        },
        addForeignKeyConstraint(
          fkName: string,
          columns: string[],
          targetTable: string,
          targetColumns: string[],
          cb?: (cb: any) => unknown,
        ) {
          const fk: FkSpec = { name: fkName, columns, targetTable, targetColumns, onDelete: null };
          const cbApi: any = {
            onDelete: (action: string) => {
              fk.onDelete = action;
              return cbApi;
            },
            onUpdate: () => cbApi,
          };
          cb?.(cbApi);
          spec.fks.push(fk);
          return b;
        },
        addUniqueConstraint(_name: string, cols: string[]) {
          indexes.push({ name: _name, table: name, columns: cols, unique: true });
          return b;
        },
        execute: async () => {
          tables.push(spec);
        },
      };
      return b;
    },

    createIndex(name: string) {
      const spec: IndexSpec = { name, table: '', columns: [], unique: false };
      const b: any = {
        on: (t: string) => {
          spec.table = t;
          return b;
        },
        columns: (cols: string[]) => {
          spec.columns = cols;
          return b;
        },
        column: (col: string) => {
          spec.columns = [col];
          return b;
        },
        unique: () => {
          spec.unique = true;
          return b;
        },
        execute: async () => {
          indexes.push(spec);
        },
      };
      return b;
    },

    dropTable(name: string) {
      const b: any = {
        ifExists: () => b,
        cascade: () => b,
        execute: async () => {
          dropped.push(name);
        },
      };
      return b;
    },

    dropIndex(name: string) {
      const b: any = {
        on: () => b,
        ifExists: () => b,
        execute: async () => {
          dropped.push(`index:${name}`);
        },
      };
      return b;
    },
  };

  return { db: { schema } as unknown as Kysely<any>, tables, indexes, dropped };
}

function col(tables: TableSpec[], table: string, column: string): ColumnSpec {
  const found = tables.find((t) => t.name === table)?.columns.find((c) => c.name === column);
  if (!found) throw new Error(`column ${table}.${column} was never created`);
  return found;
}

describe('clevertap 0001_initial migration', () => {
  it('ships 0001_initial plus the 0002/0003 forward migrations', () => {
    const dir = join(__dirname, '../../../../src/modules/clevertap/db/migrations');
    expect(
      readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .sort(),
    ).toEqual([
      '0001_initial.ts',
      '0002_catalog_and_kill_switch.ts',
      '0003_disabled_topics.ts',
      '0004_charged_source.ts',
      '0005_catalog_sync_status.ts',
      '0006_forwarding_outbox.ts',
    ]);
  });

  it('creates the three standard tables plus both clevertap tables', async () => {
    const rec = makeSchemaRecorder();

    await up(rec.db);

    expect(rec.tables.map((t) => t.name)).toEqual([
      'merchants',
      'oauth_tokens',
      'webhook_log',
      'clevertap_configs',
      'clevertap_forwarded_events',
    ]);
  });

  it('does not create the unused webhook_log index (folded 0002)', async () => {
    const rec = makeSchemaRecorder();

    await up(rec.db);

    expect(rec.indexes.map((i) => i.name)).not.toContain('idx_webhook_log_unprocessed');
  });

  describe('clevertap_configs', () => {
    it('keys on merchant_id and cascades from merchants', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const merchantId = col(rec.tables, 'clevertap_configs', 'merchant_id');
      expect(merchantId.type).toBe('varchar(128)');
      expect(merchantId.primaryKey).toBe(true);
      expect(merchantId.notNull).toBe(true);

      const fk = rec.tables.find((t) => t.name === 'clevertap_configs')?.fks[0];
      expect(fk).toMatchObject({
        columns: ['merchant_id'],
        targetTable: 'merchants',
        targetColumns: ['id'],
        onDelete: 'cascade',
      });
    });

    it('stores passcode_enc as a NULLABLE text column', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const passcode = col(rec.tables, 'clevertap_configs', 'passcode_enc');
      expect(passcode.type).toBe('text');
      expect(passcode.notNull).toBe(false);
      expect(passcode.primaryKey).toBe(false);
    });

    it('has no plaintext passcode column of any kind', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const names = rec.tables
        .find((t) => t.name === 'clevertap_configs')
        ?.columns.map((c) => c.name);
      expect(names).toContain('passcode_enc');
      expect(names).not.toContain('passcode');
    });

    it('bounds account_id and region, and defaults them for the bootstrap seed', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const accountId = col(rec.tables, 'clevertap_configs', 'account_id');
      expect(accountId.type).toBe('varchar(64)');
      expect(accountId.notNull).toBe(true);
      expect(accountId.defaultValue).toBe('');

      const region = col(rec.tables, 'clevertap_configs', 'region');
      expect(region.type).toBe('varchar(8)');
      expect(region.notNull).toBe(true);
      expect(region.defaultValue).toBe('in1');
    });

    it('defaults both flags to false and requires the events JSON', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      expect(col(rec.tables, 'clevertap_configs', 'server_events_enabled')).toMatchObject({
        type: 'boolean',
        notNull: true,
        defaultValue: false,
      });
      expect(col(rec.tables, 'clevertap_configs', 'debug')).toMatchObject({
        type: 'boolean',
        defaultValue: false,
      });
      expect(col(rec.tables, 'clevertap_configs', 'events')).toMatchObject({
        type: 'json',
        notNull: true,
      });
    });

    it('does NOT carry the template api_key / host columns', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const names = rec.tables
        .find((t) => t.name === 'clevertap_configs')
        ?.columns.map((c) => c.name);
      expect(names).not.toContain('api_key');
      expect(names).not.toContain('host');
    });
  });

  describe('clevertap_forwarded_events', () => {
    it('creates every column the forwarding path and status screen need', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const table = rec.tables.find((t) => t.name === 'clevertap_forwarded_events');
      expect(table?.columns.map((c) => c.name)).toEqual([
        'id',
        'merchant_id',
        'idempotency_key',
        'topic',
        'clevertap_event',
        'status',
        'error',
        'sent_at',
      ]);
      expect(col(rec.tables, 'clevertap_forwarded_events', 'id').primaryKey).toBe(true);
      expect(col(rec.tables, 'clevertap_forwarded_events', 'status')).toMatchObject({
        type: 'varchar(16)',
        notNull: true,
      });
      expect(col(rec.tables, 'clevertap_forwarded_events', 'error').notNull).toBe(false);
      expect(col(rec.tables, 'clevertap_forwarded_events', 'sent_at')).toMatchObject({
        type: 'datetime(3)',
        notNull: true,
        hasDefault: true,
      });
    });

    it('enforces UNIQUE (merchant_id, idempotency_key) — the double-Charged guard', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const unique = rec.indexes.find((i) => i.table === 'clevertap_forwarded_events' && i.unique);
      expect(unique).toBeDefined();
      expect(unique?.columns).toEqual(['merchant_id', 'idempotency_key']);
    });

    it('indexes (merchant_id, sent_at) for the status screen', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      const recent = rec.indexes.find((i) => i.table === 'clevertap_forwarded_events' && !i.unique);
      expect(recent?.columns).toEqual(['merchant_id', 'sent_at']);
    });

    it('cascades from merchants', async () => {
      const rec = makeSchemaRecorder();

      await up(rec.db);

      expect(rec.tables.find((t) => t.name === 'clevertap_forwarded_events')?.fks[0]).toMatchObject(
        {
          columns: ['merchant_id'],
          targetTable: 'merchants',
          targetColumns: ['id'],
          onDelete: 'cascade',
        },
      );
    });
  });

  it('down() drops in reverse dependency order', async () => {
    const rec = makeSchemaRecorder();

    await down(rec.db);

    expect(rec.dropped).toEqual([
      'clevertap_forwarded_events',
      'clevertap_configs',
      'webhook_log',
      'oauth_tokens',
      'merchants',
    ]);
  });
});
