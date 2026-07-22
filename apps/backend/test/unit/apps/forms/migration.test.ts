import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../../../../src/modules/forms/db/migrations/0001_initial';

interface ColumnSpec {
  name: string;
  type: string;
  modifiers: {
    notNull?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    autoIncrement?: boolean;
    defaultTo?: unknown;
  };
}

interface TableSpec {
  columns: ColumnSpec[];
  foreignKeys: string[];
}

/** Recorder fake for the `db.schema` builder chains 0001_initial uses. */
function fakeDb() {
  const tables: Record<string, TableSpec> = {};
  const tableOrder: string[] = [];
  const indexes: Record<string, { table?: string; columns?: string[] }> = {};
  const dropped: string[] = [];

  const createTable = (name: string) => {
    const spec: TableSpec = { columns: [], foreignKeys: [] };
    tables[name] = spec;
    tableOrder.push(name);
    const chain = {
      addColumn: (col: string, type: unknown, cb?: (b: unknown) => unknown) => {
        const modifiers: ColumnSpec['modifiers'] = {};
        const builder = {
          notNull: () => {
            modifiers.notNull = true;
            return builder;
          },
          primaryKey: () => {
            modifiers.primaryKey = true;
            return builder;
          },
          unique: () => {
            modifiers.unique = true;
            return builder;
          },
          autoIncrement: () => {
            modifiers.autoIncrement = true;
            return builder;
          },
          defaultTo: (v: unknown) => {
            modifiers.defaultTo = v;
            return builder;
          },
        };
        cb?.(builder);
        spec.columns.push({ name: col, type: String(type), modifiers });
        return chain;
      },
      addForeignKeyConstraint: (fkName: string) => {
        spec.foreignKeys.push(fkName);
        return chain;
      },
      execute: async () => undefined,
    };
    return chain;
  };

  const createIndex = (name: string) => {
    const spec: { table?: string; columns?: string[] } = {};
    indexes[name] = spec;
    const chain = {
      on: (table: string) => {
        spec.table = table;
        return chain;
      },
      columns: (indexCols: string[]) => {
        spec.columns = indexCols;
        return chain;
      },
      execute: async () => undefined,
    };
    return chain;
  };

  const dropTable = (name: string) => ({
    ifExists: () => ({ execute: async () => dropped.push(name) }),
  });

  // biome-ignore lint/suspicious/noExplicitAny: migration API uses Kysely<any>
  const db = { schema: { createTable, createIndex, dropTable } } as unknown as Kysely<any>;
  return { db, tables, tableOrder, indexes, dropped };
}

const cols = (t: TableSpec) => t.columns.map((c) => c.name);
const col = (t: TableSpec, name: string) => {
  const found = t.columns.find((c) => c.name === name);
  expect(found, `column ${name}`).toBeTruthy();
  return found as ColumnSpec;
};

describe('forms 0001_initial migration (migration lockstep smoke, TDD §3.9)', () => {
  it('creates exactly the standard triad + the five forms tables', async () => {
    const { db, tableOrder } = fakeDb();
    await up(db);
    expect(tableOrder).toEqual([
      'merchants',
      'oauth_tokens',
      'webhook_log',
      'forms_configs',
      'forms',
      'form_submissions',
      'form_webhook_deliveries',
      'form_email_log',
    ]);
  });

  it('forms_configs: TRD §3 columns, merchant FK, threshold default 0.30, kill switch default on', async () => {
    const { db, tables } = fakeDb();
    await up(db);
    const t = tables.forms_configs;
    expect(cols(t)).toEqual(
      expect.arrayContaining([
        'merchant_id',
        'recaptcha_site_key',
        'recaptcha_secret_enc',
        'recaptcha_threshold',
        'default_notification_email',
        'email_bounced',
        'forms_enabled',
        'created_at',
        'updated_at',
      ]),
    );
    expect(col(t, 'merchant_id').modifiers.primaryKey).toBe(true);
    expect(col(t, 'recaptcha_threshold').type).toContain('decimal(3, 2)');
    expect(col(t, 'recaptcha_threshold').modifiers.defaultTo).toBe(0.3);
    expect(col(t, 'forms_enabled').modifiers.defaultTo).toBe(true);
    expect(col(t, 'email_bounced').modifiers.defaultTo).toBe(false);
    expect(t.foreignKeys).toContain('fk_forms_configs_merchant');
  });

  it('forms: schema/metadata columns, merchant FK, soft-delete + (merchant_id, deleted_at) index', async () => {
    const { db, tables, indexes } = fakeDb();
    await up(db);
    const t = tables.forms;
    expect(cols(t)).toEqual(
      expect.arrayContaining([
        'id',
        'merchant_id',
        'name',
        'schema_json',
        'submit_label',
        'success_message',
        'spam_protection',
        'notification_email',
        'webhook_url',
        'status',
        'deleted_at',
        'created_at',
        'updated_at',
      ]),
    );
    expect(col(t, 'status').modifiers.defaultTo).toBe('inactive');
    expect(col(t, 'spam_protection').modifiers.defaultTo).toBe('recaptcha');
    expect(t.foreignKeys).toContain('fk_forms_merchant');
    expect(indexes.idx_forms_merchant_deleted).toEqual({
      table: 'forms',
      columns: ['merchant_id', 'deleted_at'],
    });
  });

  it('form_submissions: UNIQUE idempotency_key + (form_id, created_at) index', async () => {
    const { db, tables, indexes } = fakeDb();
    await up(db);
    const t = tables.form_submissions;
    expect(cols(t)).toEqual(
      expect.arrayContaining([
        'id',
        'form_id',
        'merchant_id',
        'data_json',
        'files_json',
        'recaptcha_score',
        'idempotency_key',
        'created_at',
      ]),
    );
    expect(col(t, 'idempotency_key').modifiers.unique).toBe(true);
    expect(col(t, 'idempotency_key').modifiers.notNull).toBe(true);
    expect(indexes.idx_form_submissions_form_created).toEqual({
      table: 'form_submissions',
      columns: ['form_id', 'created_at'],
    });
  });

  it('delivery + email log: autoincrement PKs and the sweeper (status, next_retry_at) indexes', async () => {
    const { db, tables, indexes } = fakeDb();
    await up(db);

    const deliveries = tables.form_webhook_deliveries;
    expect(cols(deliveries)).toEqual(
      expect.arrayContaining([
        'id',
        'submission_id',
        'form_id',
        'merchant_id',
        'url',
        'status',
        'attempts',
        'last_status_code',
        'next_retry_at',
        'created_at',
        'updated_at',
      ]),
    );
    expect(col(deliveries, 'id').modifiers.autoIncrement).toBe(true);
    expect(col(deliveries, 'status').modifiers.defaultTo).toBe('pending');
    expect(col(deliveries, 'attempts').modifiers.defaultTo).toBe(0);
    expect(indexes.idx_form_webhook_deliveries_status_retry).toEqual({
      table: 'form_webhook_deliveries',
      columns: ['status', 'next_retry_at'],
    });

    const emailLog = tables.form_email_log;
    expect(cols(emailLog)).toEqual(
      expect.arrayContaining([
        'id',
        'submission_id',
        'merchant_id',
        'recipient',
        'status',
        'attempts',
        'next_retry_at',
        'created_at',
        'updated_at',
      ]),
    );
    expect(col(emailLog, 'id').modifiers.autoIncrement).toBe(true);
    expect(indexes.idx_form_email_log_status_retry).toEqual({
      table: 'form_email_log',
      columns: ['status', 'next_retry_at'],
    });
  });

  it('down() drops every table, children before merchants', async () => {
    const { db, dropped } = fakeDb();
    await down(db);
    expect(dropped).toEqual([
      'form_email_log',
      'form_webhook_deliveries',
      'form_submissions',
      'forms',
      'forms_configs',
      'webhook_log',
      'oauth_tokens',
      'merchants',
    ]);
  });
});
