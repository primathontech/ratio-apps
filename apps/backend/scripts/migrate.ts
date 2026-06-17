#!/usr/bin/env tsx
/**
 * Generic migrate-to-latest entry point.
 *
 * Usage:
 *   tsx scripts/migrate.ts <slug>  # e.g. _template
 *
 * Replaces the two near-identical per-module migrate.ts scripts that used
 * to live under `src/modules/<slug>/scripts/`. All real logic lives in
 * `./lib/migrate-runner.ts`; this file just parses argv and delegates.
 */

import { isModuleSlug, migrateUp } from './lib/migrate-runner';

const slug = process.argv[2];
if (!isModuleSlug(slug)) {
  console.error('usage: tsx scripts/migrate.ts <slug>  # e.g. _template');
  process.exit(1);
}

migrateUp(slug).catch((err) => {
  console.error(err);
  process.exit(1);
});
