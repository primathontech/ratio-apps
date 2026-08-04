import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The governing rule of the FBT migration: while the OLD backend is still
 * serving live merchants, both backends run against ONE database. So every
 * migration in the initial phase must be backward-compatible — additive only.
 *
 * This test is the executable form of that rule. It reads 0001's source and
 * fails on any destructive DDL. Destructive changes belong in 0002, which runs
 * only after the old backend is decommissioned.
 */
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../src/modules/fbt/db/migrations/0001_initial.ts',
);

function migrationSource(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

/**
 * Remove text that is INERT — present in the source but never executed as DDL — so a
 * destructive keyword appearing there cannot fail the test. Two categories:
 *
 *  1. Comments. An explanatory comment saying "0002 will dropColumn" is not a drop.
 *  2. `throw new Error(...)` arguments. The migration's recovery messages deliberately
 *     contain the literal text `DROP TABLE …` so an operator can paste it. That is
 *     instructional prose, not an executed statement.
 *
 * Deliberately NOT stripped: string and template literals in general. `sql`DROP TABLE x``
 * IS a template literal, so a blanket string-strip would gut this entire guard. The
 * `throw` carve-out is narrow on purpose — DDL is never executed from inside a throw's
 * argument in any realistic migration. `stripsInertText` below is the regression test
 * proving this stripping keeps its teeth.
 */
export function stripInertText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\/\/.*$/gm, '')
    .replace(/throw new Error\([\s\S]*?\);/g, 'throw new Error();');
}

function upBody(src: string): string {
  const stripped = stripInertText(src);
  const upStart = stripped.indexOf('export async function up');
  const downStart = stripped.indexOf('export async function down');
  expect(upStart).toBeGreaterThan(-1);
  expect(downStart).toBeGreaterThan(upStart);
  return stripped.slice(upStart, downStart);
}

describe('stripInertText keeps its teeth', () => {
  // This guard's value depends entirely on it NOT over-stripping. The `throw` carve-out
  // exists so the migration's own `DROP TABLE …` recovery prose does not trip the
  // `raw DROP` pattern — but if that carve-out ever widened to strings generally, every
  // `sql`DROP TABLE …`` would become invisible and this whole file would silently pass
  // anything. These are the negative controls.
  const synthetic = [
    'export async function up(db) {',
    '  await sql`DROP TABLE victim`.execute(db);',
    '  await db.schema.dropTable("other").execute();',
    '  await sql`TRUNCATE audit_log`.execute(db);',
    '  throw new Error("recovery: DROP TABLE inert_prose;");',
    '}',
    'export async function down(db) {}',
  ].join('\n');

  const stripped = stripInertText(synthetic);

  it('still sees an executable raw DROP TABLE', () => {
    expect(stripped).toMatch(/\bDROP\s+TABLE\b/i);
  });

  it('still sees a builder .dropTable() call', () => {
    expect(stripped).toMatch(/\.dropTable\(/);
  });

  it('still sees a raw TRUNCATE', () => {
    expect(stripped).toMatch(/\bTRUNCATE\b/i);
  });

  it('removes the inert throw-message prose', () => {
    expect(stripped).not.toContain('inert_prose');
  });
});

describe('fbt 0001_initial is additive', () => {
  it('exports up and down', () => {
    const src = migrationSource();
    expect(src).toContain('export async function up');
    expect(src).toContain('export async function down');
  });

  it.each([
    ['dropTable', /\.dropTable\(/],
    ['dropColumn', /\.dropColumn\(/],
    ['renameTo', /\.renameTo\(/],
    ['renameColumn', /\.renameColumn\(/],
    ['dropConstraint', /\.dropConstraint\(/],
    ['dropIndex', /\.dropIndex\(/],
    ['raw DROP', /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)\b/i],
    ['raw TRUNCATE', /\bTRUNCATE\b/i],
  ])('up() contains no %s', (_label, pattern) => {
    expect(upBody(migrationSource())).not.toMatch(pattern);
  });

  it('up() adds no NOT NULL column without a default to an EXISTING table', () => {
    const body = upBody(migrationSource());
    // Split into statements, each beginning at .createTable( or .alterTable(.
    const statements = body.split(/(?=\.\s*(?:createTable|alterTable)\()/);
    for (const stmt of statements) {
      // Only ALTER TABLE … ADD COLUMN can break the old backend: a NOT NULL column
      // with no default added to a POPULATED table rejects that backend's existing
      // INSERTs. On a brand-new table there is no backward-compat risk at all — and
      // a primary key is necessarily NOT NULL, so a blanket rule would forbid
      // creating well-formed tables. Skip createTable statements entirely.
      if (!/\.\s*alterTable\(/.test(stmt)) continue;
      const addColumnCalls = stmt.match(/\.addColumn\([\s\S]*?\)\s*(?=\.\s*(addColumn|addUnique|addForeignKey|addPrimaryKey|execute))/g) ?? [];
      for (const call of addColumnCalls) {
        if (/notNull\(\)/.test(call)) {
          expect(call, `NOT NULL without defaultTo on an existing table:\n${call}`).toMatch(
            /defaultTo\(/,
          );
        }
      }
    }
  });

  // The eight patterns above catch Kysely builder calls and raw DROP/TRUNCATE, but
  // NOT `ALTER TABLE … MODIFY`, which can silently tighten a column out from under
  // the old backend. We cannot ban MODIFY outright: 0001 legitimately RELAXES
  // `product_embeddings.embedding_vector` from NOT NULL to NULL, without which the
  // new module's blob-only insert fails. So gate on direction, not on the keyword.
  it('up() never TIGHTENS a column to NOT NULL via ALTER … MODIFY', () => {
    const body = upBody(migrationSource());
    // Each MODIFY clause up to the end of its template literal / statement.
    const modifies = body.match(/\bMODIFY\b[\s\S]*?(?=`|;|$)/gi) ?? [];
    for (const stmt of modifies) {
      expect(stmt, `MODIFY tightens a column to NOT NULL:\n${stmt}`).not.toMatch(
        /\bNOT\s+NULL\b/i,
      );
    }
  });

  it('up() renames no column via ALTER … CHANGE', () => {
    // CHANGE both renames and retypes; a rename is invisible to the old backend
    // until it errors at runtime. Always destructive, never sanctioned.
    expect(upBody(migrationSource())).not.toMatch(/\bALTER\s+TABLE\b[\s\S]{0,300}?\bCHANGE\b/i);
  });

  it('does not create any table that already exists in production', () => {
    const body = upBody(migrationSource());
    // These five are pre-existing production tables. 0001 may ALTER them,
    // never CREATE them.
    for (const table of [
      'frequently_bought_bundle',
      'merchant_recommendation_config',
      'product_embeddings',
      'product_similarity_cache',
      'bundle_generation_jobs',
    ]) {
      expect(body).not.toMatch(new RegExp(`createTable\\(['"]${table}['"]\\)`));
    }
  });

  it('creates the shared tables via the core helper, not by hand', () => {
    const src = migrationSource();
    expect(src).toContain('createSharedTables');
    const body = upBody(src);
    for (const table of ['merchants', 'oauth_tokens', 'webhook_log']) {
      expect(body).not.toMatch(new RegExp(`createTable\\(['"]${table}['"]\\)`));
    }
  });
});
