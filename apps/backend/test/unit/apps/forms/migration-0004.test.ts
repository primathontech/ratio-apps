import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../../../../src/modules/forms/db/migrations/0004_form_metadata';

/** Recorder fake for the `db.schema.alterTable` chains 0004 uses. */
function fakeDb() {
  const added: Array<{ table: string; column: string; type: string }> = [];
  const dropped: Array<{ table: string; column: string }> = [];

  const alterTable = (table: string) => ({
    addColumn: (column: string, type: unknown) => ({
      execute: async () => {
        added.push({ table, column, type: String(type) });
      },
    }),
    dropColumn: (column: string) => ({
      execute: async () => {
        dropped.push({ table, column });
      },
    }),
  });

  // biome-ignore lint/suspicious/noExplicitAny: migration API uses Kysely<any>
  const db = { schema: { alterTable } } as unknown as Kysely<any>;
  return { db, added, dropped };
}

describe('forms 0004_form_metadata migration (lockstep with types.ts)', () => {
  it('adds nullable description + redirect_url columns to forms', async () => {
    const { db, added } = fakeDb();
    await up(db);
    expect(added).toEqual([
      { table: 'forms', column: 'description', type: 'varchar(500)' },
      { table: 'forms', column: 'redirect_url', type: 'varchar(2048)' },
    ]);
  });

  it('down() drops both columns', async () => {
    const { db, dropped } = fakeDb();
    await down(db);
    expect(dropped).toEqual([
      { table: 'forms', column: 'redirect_url' },
      { table: 'forms', column: 'description' },
    ]);
  });
});
