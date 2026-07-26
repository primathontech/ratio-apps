import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../../../../src/modules/forms/db/migrations/0005_submission_context';

/** Recorder fake for the `db.schema.alterTable` chains 0005 uses. */
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

describe('forms 0005_submission_context migration (lockstep with types.ts)', () => {
  it('adds the nullable context_json json column to form_submissions', async () => {
    const { db, added } = fakeDb();
    await up(db);
    expect(added).toEqual([{ table: 'form_submissions', column: 'context_json', type: 'json' }]);
  });

  it('down() drops context_json', async () => {
    const { db, dropped } = fakeDb();
    await down(db);
    expect(dropped).toEqual([{ table: 'form_submissions', column: 'context_json' }]);
  });
});
