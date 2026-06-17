/**
 * Shared runner for the per-module migrate / migrate-down scripts.
 *
 * Why this exists: the two `tsx` entry points (`scripts/migrate.ts` and
 * `scripts/migrate-down.ts`) want identical env loading, identical
 * migrations-folder resolution, identical Kysely / mysql2 wiring, and
 * differ only in the Migrator call. Putting all of that here keeps the
 * entry-point files at <30 lines and means there's exactly one place to
 * touch when env-discovery or pooling changes.
 */

import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Kysely, MysqlDialect } from 'kysely';
import { FileMigrationProvider, type MigrationResultSet, Migrator } from 'kysely/migration';
import { createPool } from 'mysql2';
import { APPS, type AppSlug } from '../../src/config/apps';

export type ModuleSlug = AppSlug;

const KNOWN_SLUGS: readonly ModuleSlug[] = APPS;

export function isModuleSlug(value: string | undefined): value is ModuleSlug {
  return !!value && (KNOWN_SLUGS as readonly string[]).includes(value);
}

/**
 * Walk up from CWD looking for env files. Load order (later wins on conflict):
 *
 *   1. `.env`                  — baseline / dev defaults
 *   2. `.env.local`            — local-only overrides (gitignored)
 *   3. `.env.production`       — only when NODE_ENV=production
 *
 * The NODE_ENV=production path is what lets a prod box (where some OTHER
 * service may have dropped a stray `.env.local` further up the tree)
 * still resolve our `RATIO_*` vars from `.env.production` regardless.
 *
 * Walker bound to 6 ancestors so cwd outside the repo doesn't loop forever.
 */
function loadEnvFiles(): void {
  const find = (filename: string): string | null => {
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const candidate = path.resolve(dir, filename);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };
  const sources: Array<readonly [string, boolean]> = [
    ['.env', false],
    ['.env.local', true],
  ];
  if (process.env.NODE_ENV === 'production') {
    sources.push(['.env.production', true]);
  }
  for (const [file, override] of sources) {
    const found = find(file);
    if (found) {
      loadDotenv({ path: found, override });
      console.log(`[migrate] loaded env from ${found}${override ? ' (override)' : ''}`);
    }
  }
}

function resolveMigrationsFolder(slug: ModuleSlug): string {
  const candidates = [
    // When run via `pnpm --filter @ratio-app/backend exec tsx scripts/migrate.ts`,
    // __dirname is `apps/backend/scripts/lib`, so step up two to reach `apps/backend`.
    path.resolve(__dirname, '..', '..', 'src', 'modules', slug, 'db', 'migrations'),
    // Fallback for when scripts are invoked from a different cwd (e.g. CI).
    path.resolve(process.cwd(), 'apps', 'backend', 'src', 'modules', slug, 'db', 'migrations'),
    path.resolve(process.cwd(), 'src', 'modules', slug, 'db', 'migrations'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error(`[migrate:${slug}] migrations folder not found. Tried:`, candidates);
    process.exit(1);
  }
  return found;
}

function databaseUrlFor(slug: ModuleSlug): string {
  const envKey = `RATIO_${slug.toUpperCase()}_DATABASE_URL`;
  const url = process.env[envKey];
  if (!url) {
    console.error(`[migrate:${slug}] ${envKey} is not set`);
    process.exit(1);
  }
  return url;
}

function buildMigrator(slug: ModuleSlug): { db: Kysely<unknown>; migrator: Migrator } {
  loadEnvFiles();
  const databaseUrl = databaseUrlFor(slug);
  const migrationFolder = resolveMigrationsFolder(slug);

  const pool = createPool({ uri: databaseUrl, connectionLimit: 1 });
  const db = new Kysely<unknown>({ dialect: new MysqlDialect({ pool }) });
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  });
  console.log(`[migrate:${slug}] using migrations from ${migrationFolder}`);
  return { db, migrator };
}

function reportResults(slug: ModuleSlug, results: MigrationResultSet['results']): void {
  results?.forEach((r) => {
    if (r.status === 'Success') console.log(`[migrate:${slug}] OK ${r.migrationName}`);
    if (r.status === 'Error') console.error(`[migrate:${slug}] FAIL ${r.migrationName}`);
  });
}

export async function migrateUp(slug: ModuleSlug): Promise<void> {
  const { db, migrator } = buildMigrator(slug);
  try {
    const { error, results } = await migrator.migrateToLatest();
    reportResults(slug, results);
    if (error) {
      console.error(`[migrate:${slug}] failed:`, error);
      throw new Error(`[migrate:${slug}] migration failed`);
    }
    if (!results || results.length === 0) {
      console.log(`[migrate:${slug}] no pending migrations`);
    }
    console.log(`[migrate:${slug}] done`);
  } finally {
    await db.destroy();
  }
}

export async function migrateDown(slug: ModuleSlug): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.I_REALLY_MEAN_IT !== 'yes') {
    console.error(
      `[migrate-down] Refusing to run with NODE_ENV=production.\n` +
        `If you genuinely want to roll back in production, set I_REALLY_MEAN_IT=yes\n` +
        `AND make sure you have a fresh backup. Production rollback should usually\n` +
        `be a curated SQL script reviewed by ops, not this script.`,
    );
    process.exit(1);
  }
  const { db, migrator } = buildMigrator(slug);
  try {
    // Destructive-migration guard: rolling back the initial migration drops
    // the shared tables (merchants, oauth_tokens, webhook_log) and any
    // module-specific tables created in 0001. Require an explicit opt-in.
    const migrations = await migrator.getMigrations();
    const executed = migrations.filter((m) => m.executedAt !== undefined);
    const target = executed[executed.length - 1];
    if (target && /initial|create.*tables/i.test(target.name)) {
      const force = process.argv.includes('--yes-i-know-this-drops-tables');
      if (!force) {
        console.error(
          `[migrate-down] About to roll back '${target.name}' which is destructive ` +
            `(drops shared tables). Re-run with --yes-i-know-this-drops-tables to confirm.`,
        );
        throw new Error('destructive migrate-down refused without explicit confirmation');
      }
    }

    const { error, results } = await migrator.migrateDown();
    reportResults(slug, results);
    if (error) {
      console.error(`[migrate:${slug}] rollback failed:`, error);
      throw new Error(`[migrate:${slug}] rollback failed`);
    }
    if (!results || results.length === 0) {
      console.log(`[migrate:${slug}] nothing to roll back`);
    }
    console.log(`[migrate:${slug}] rollback done`);
  } finally {
    await db.destroy();
  }
}
