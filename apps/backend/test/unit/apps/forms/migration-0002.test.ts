import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../../../../src/modules/forms/db/migrations/0002_export_jobs';

interface ColumnSpec {
  name: string;
  type: string;
  modifiers: { notNull?: boolean; primaryKey?: boolean; defaultTo?: unknown };
}

/** Recorder fake for the `db.schema` chains 0002 uses. */
function fakeDb() {
  const tables: Record<string, ColumnSpec[]> = {};
  const indexes: Record<string, { table?: string; columns?: string[] }> = {};
  const dropped: string[] = [];

  const createTable = (name: string) => {
    const cols: ColumnSpec[] = [];
    tables[name] = cols;
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
          defaultTo: (v: unknown) => {
            modifiers.defaultTo = v;
            return builder;
          },
        };
        cb?.(builder);
        cols.push({ name: col, type: String(type), modifiers });
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
  return { db, tables, indexes, dropped };
}

describe('forms 0002_export_jobs migration (lockstep with types.ts)', () => {
  it('creates form_export_jobs with the documented columns + merchant/form/created index', async () => {
    const { db, tables, indexes } = fakeDb();
    await up(db);
    const cols = tables.form_export_jobs;
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'form_id',
      'merchant_id',
      'status',
      's3_key',
      'row_count',
      'error',
      'created_at',
      'updated_at',
    ]);
    const id = cols.find((c) => c.name === 'id');
    expect(id?.modifiers.primaryKey).toBe(true);
    expect(cols.find((c) => c.name === 'status')?.modifiers.defaultTo).toBe('pending');
    expect(cols.find((c) => c.name === 'row_count')?.type).toBe('integer');
    expect(indexes.idx_form_export_jobs_merchant_form_created).toEqual({
      table: 'form_export_jobs',
      columns: ['merchant_id', 'form_id', 'created_at'],
    });
  });

  it('down() drops the table', async () => {
    const { db, dropped } = fakeDb();
    await down(db);
    expect(dropped).toEqual(['form_export_jobs']);
  });
});
