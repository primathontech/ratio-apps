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

/** Strip comments so a word inside an explanatory comment can't fail the test. */
function upBody(src: string): string {
  const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.replace(/\s*\/\/.*$/gm, '');
  const upStart = withoutLineComments.indexOf('export async function up');
  const downStart = withoutLineComments.indexOf('export async function down');
  expect(upStart).toBeGreaterThan(-1);
  expect(downStart).toBeGreaterThan(upStart);
  return withoutLineComments.slice(upStart, downStart);
}

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

  it('up() adds no NOT NULL column without a default', () => {
    const body = upBody(migrationSource());
    // Each addColumn(...) call's callback, e.g. `(c) => c.notNull().defaultTo(...)`.
    const addColumnCalls = body.match(/\.addColumn\([\s\S]*?\)\s*(?=\.\s*(addColumn|addUnique|addForeignKey|addPrimaryKey|execute))/g) ?? [];
    for (const call of addColumnCalls) {
      if (/notNull\(\)/.test(call)) {
        expect(call, `NOT NULL without defaultTo:\n${call}`).toMatch(/defaultTo\(/);
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
