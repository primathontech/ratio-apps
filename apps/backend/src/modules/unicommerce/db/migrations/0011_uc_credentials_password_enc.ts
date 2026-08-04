/**
 * 0011 — Switch uc_credentials' password storage from a one-way scrypt hash
 * to reversible AES-GCM encryption (same mechanism already used for
 * oauth_tokens.access_token_enc / refresh_token_enc via CryptoService).
 *
 * Deliberate security trade-off, explicitly confirmed with the user: this
 * lets the admin UI show the previously-generated password again (an eye
 * icon, not just at generation time) at the cost of a hash's stronger
 * guarantee (irreversible even if the DB AND the encryption key both leak).
 * Acceptable here because this is a scoped API credential Unicommerce's own
 * backend uses to call ours, not a reused human login password, and a
 * "Regenerate" action (also new) lets a merchant invalidate an old value on
 * demand.
 *
 * Renaming (not just reinterpreting) `password_hash` -> `password_enc` is
 * deliberate: the column now holds a fundamentally different kind of value
 * (decryptable ciphertext, not a comparison hash), and any pre-existing
 * hashed value would be silently wrong if left under the old name. This is a
 * pre-production module (no real merchant depends on an existing hashed
 * credential surviving this migration) — existing rows are dropped and must
 * be regenerated, which is fine because they were never revealed since.
 */
import type { Kysely } from 'kysely';

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function up(db: Kysely<any>): Promise<void> {
  // Existing values are one-way hashes, not decryptable to anything — no
  // migration-in-place is possible, so clear them out rather than ship a
  // column that LOOKS like ciphertext but isn't.
  await db.deleteFrom('uc_credentials').execute();
  await db.schema
    .alterTable('uc_credentials')
    .renameColumn('password_hash', 'password_enc')
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: Migrator API uses Kysely<any>
export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('uc_credentials').execute();
  await db.schema
    .alterTable('uc_credentials')
    .renameColumn('password_enc', 'password_hash')
    .execute();
}
