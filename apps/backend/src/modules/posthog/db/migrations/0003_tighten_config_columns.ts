/**
 * D3 — tighten `posthog_configs.api_key` and `posthog_configs.host` from
 * TEXT to bounded VARCHAR.
 *
 * Real PostHog project API keys are 36-50 characters; hosts top out around
 * 60 (e.g. "https://us.i.posthog.com"). VARCHAR(128) for api_key and
 * VARCHAR(255) for host leave generous headroom while letting MySQL inline
 * the values in the row (TEXT is stored off-page above 40 bytes, which
 * costs an extra I/O on every config load). Don't tighten further — keys
 * are an upstream-controlled format and the next rotation could push them
 * to 64+ bytes.
 *
 * Safe here: there is no existing data whose api_key exceeds 128 chars or
 * whose host exceeds 255 (PostHog hosts are URLs, capped well below 255).
 */

import { type Kysely, sql } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // IMPORTANT: TEXT → VARCHAR narrowing forces MySQL ALGORITHM=COPY (full table
  // rewrite + shared metadata lock). Safe here because posthog_configs is one
  // row per merchant — the table is tiny. If you copy this pattern to a hot
  // table (e.g. webhook_log.payload), you MUST validate ALGORITHM/LOCK on
  // MySQL's actual chosen plan first via `EXPLAIN ANALYZE` or staging trial.
  await sql`ALTER TABLE posthog_configs
    MODIFY api_key VARCHAR(128) NOT NULL,
    MODIFY host VARCHAR(255) NOT NULL,
    ALGORITHM=COPY, LOCK=SHARED`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  // VARCHAR → TEXT widening is also ALGORITHM=COPY in MySQL (TEXT changes
  // off-page storage semantics, so the engine must rewrite the table). Same
  // safety reasoning as up(): posthog_configs is tiny.
  await sql`ALTER TABLE posthog_configs
    MODIFY api_key TEXT NOT NULL,
    MODIFY host TEXT NOT NULL,
    ALGORITHM=COPY, LOCK=SHARED`.execute(db);
}
