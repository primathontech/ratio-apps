import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cheap structural guard: every table in `FbtDatabase` must be created by `0001`, and
 * every `fbt_` table must carry a merchant foreign key.
 *
 * This is deliberately source-text analysis, not a live-database comparison. The repo
 * has no DB-backed test harness — every existing test uses fakes or reads files — and a
 * live comparison would need a running MySQL in CI. What this catches is the realistic
 * failure: someone adds a table or column to `db/types.ts` and forgets the migration,
 * or vice versa.
 */
const MODULE_DIR = resolve(__dirname, '../../../../src/modules/fbt');
const types = readFileSync(resolve(MODULE_DIR, 'db/types.ts'), 'utf8');
const migration = readFileSync(resolve(MODULE_DIR, 'db/migrations/0001_initial.ts'), 'utf8');

/** Table names declared as keys of the FbtDatabase interface. */
function declaredTables(src: string): string[] {
  const block = src.slice(src.indexOf('export interface FbtDatabase'));
  const body = block.slice(block.indexOf('{'), block.indexOf('}'));
  return [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1] as string);
}

const SHARED = ['merchants', 'oauth_tokens', 'webhook_log'];

describe('FbtDatabase matches 0001_initial', () => {
  const tables = declaredTables(types);

  it('declares the nine expected tables', () => {
    expect(tables.sort()).toEqual(
      [
        'fbt_bundles',
        'fbt_generation_jobs',
        'fbt_merchant_config',
        'fbt_product_embeddings',
        'fbt_similarity_cache',
        'fbt_sweep_lease',
        'merchants',
        'oauth_tokens',
        'webhook_log',
      ].sort(),
    );
  });

  it('creates the three shared tables via the core helper, not by hand', () => {
    expect(migration).toContain('createSharedTables');
    for (const t of SHARED) {
      expect(migration).not.toMatch(new RegExp(`createTable\\(['"]${t}['"]\\)`));
    }
  });

  it.each(
    declaredTables(types).filter((t) => !SHARED.includes(t)),
  )('0001 creates %s', (table) => {
    expect(migration).toMatch(new RegExp(`createTable\\(['"]${table}['"]\\)`));
  });

  it.each(
    declaredTables(types).filter((t) => !SHARED.includes(t) && t !== 'fbt_sweep_lease'),
  )('%s has a merchant foreign key', (table) => {
    // fbt_sweep_lease is global, not per-merchant — the only legitimate exception.
    const block = migration.slice(
      migration.indexOf(`createTable('${table}')`),
      migration.indexOf('.execute()', migration.indexOf(`createTable('${table}')`)),
    );
    expect(block).toContain('addForeignKeyConstraint');
    expect(block).toContain("'merchants'");
  });

  it('declares no platform column anywhere', () => {
    // Match a property DECLARATION, not the bare word: both files legitimately mention
    // "no `platform` column" in their docstrings, and a `/\bplatform\b/` check would
    // fail on correct code that merely documents the absence.
    expect(types).not.toMatch(/^\s+platform\??:/m);
    expect(migration).not.toMatch(/addColumn\(\s*'platform'/);
  });

  it('declares no legacy embedding_vector column', () => {
    expect(types).not.toContain('embeddingVector');
    expect(migration).not.toContain('embedding_vector');
  });

  it('uses varchar(128) for every merchant_id, matching merchants.id', () => {
    const merchantIdCols = [...migration.matchAll(/addColumn\('merchant_id', '([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(merchantIdCols.length).toBeGreaterThan(0);
    for (const t of merchantIdCols) expect(t).toBe('varchar(128)');
  });
});
