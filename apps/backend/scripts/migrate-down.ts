#!/usr/bin/env tsx
/**
 * DEV/STAGING ONLY. Rolls back the most-recently-applied migration on the
 * targeted module's DB. Production rollbacks must use a curated SQL
 * script reviewed by ops — this helper is not safe for prod use:
 *   - It runs the migration's `down()` against live data with no dry-run.
 *   - It assumes the `down()` is correct; a flawed `down()` won't be
 *     caught until you discover the lossy state in prod.
 *   - It has no locking against concurrent migrate runs in the same DB.
 *
 * Usage:
 *   tsx scripts/migrate-down.ts <slug>  # e.g. _template
 */

import { isModuleSlug, migrateDown } from './lib/migrate-runner';

const slug = process.argv[2];
if (!isModuleSlug(slug)) {
  console.error('usage: tsx scripts/migrate-down.ts <slug>  # e.g. _template');
  process.exit(1);
}

migrateDown(slug).catch((err) => {
  console.error(err);
  process.exit(1);
});
