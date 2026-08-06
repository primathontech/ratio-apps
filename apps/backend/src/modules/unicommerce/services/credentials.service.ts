import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UC_CRYPTO } from '../tokens';

export interface StoredCredentials {
  username: string;
  password: string;
  ucUsername: string;
  lastInboundCallAt: Date | null;
}

/**
 * Thrown by `generate()` when the merchant already has credentials on file
 * (merchantId is the table's primary key, so a second `generate()` call
 * hits a duplicate-key error). Surfaced as a distinct error type — not a
 * generic 500 — so the controller can turn it into a clear, actionable
 * response rather than an opaque "internal server error". Found live: a
 * stale frontend build called `generate()` for a merchant that already had
 * credentials (from a prior generate/regenerate), and got a bare 500 with
 * no indication of what actually went wrong.
 */
export class CredentialsAlreadyExistError extends Error {
  constructor(merchantId: string) {
    super(`credentials already exist for merchant ${merchantId} — use regenerate instead`);
    this.name = 'CredentialsAlreadyExistError';
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | undefined;
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}

@Injectable()
export class UcCredentialsService {
  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    @Inject(UC_CRYPTO) private readonly crypto: CryptoService,
  ) {}

  private get db(): Kysely<UnicommerceDatabase> {
    return 'db' in this.handle
      ? (this.handle as { db: Kysely<UnicommerceDatabase> }).db
      : (this.handle as unknown as Kysely<UnicommerceDatabase>);
  }

  /**
   * Generates a fresh Ratio-issued username/password for a merchant to paste
   * into their own Unicommerce "Ratio channel" settings. `ucUsername` is the
   * MERCHANT'S OWN Unicommerce login, captured in the same connect step — it
   * becomes the `merchantid` header on every outbound push, NOT something we
   * authenticate with ourselves.
   *
   * First-time only — throws on a duplicate-key conflict (merchantId is the
   * table's primary key) rather than silently overwriting; use `regenerate()`
   * to intentionally replace an existing merchant's credentials.
   */
  async generate(
    merchantId: string,
    ucUsername: string,
  ): Promise<{ username: string; password: string }> {
    const username = `ratio-${randomBytes(6).toString('hex')}`;
    const password = randomBytes(18).toString('base64url');

    try {
      await this.db
        .insertInto('ucCredentials')
        .values({
          merchantId,
          ratioUsername: username,
          passwordEnc: this.crypto.encrypt(password),
          ucUsername,
          status: 'active',
        })
        .execute();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new CredentialsAlreadyExistError(merchantId);
      throw err;
    }

    return { username, password };
  }

  /**
   * Mints a brand-new Ratio username/password for a merchant that already
   * has credentials on file, keeping their existing `ucUsername` (that
   * hasn't changed — only the Ratio-issued side is being reset). The OLD
   * username/password stop working the instant this commits: `verify()`
   * looks up by exact `ratioUsername`, and the old one no longer exists in
   * the table once this UPSERT replaces the row.
   */
  async regenerate(merchantId: string): Promise<{ username: string; password: string } | null> {
    const existing = await this.db
      .selectFrom('ucCredentials')
      .select('ucUsername')
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!existing) return null;

    const username = `ratio-${randomBytes(6).toString('hex')}`;
    const password = randomBytes(18).toString('base64url');

    await this.db
      .updateTable('ucCredentials')
      .set({
        ratioUsername: username,
        passwordEnc: this.crypto.encrypt(password),
        status: 'active',
      })
      .where('merchantId', '=', merchantId)
      .execute();

    return { username, password };
  }

  /**
   * Retrieves the currently-active credentials for a merchant (decrypting
   * the password) so the admin UI can re-display them on a later visit —
   * unlike a one-way hash, this is possible precisely BECAUSE `passwordEnc`
   * is reversible ciphertext (see migration 0011's rationale comment).
   * Returns null if the merchant has never generated credentials.
   */
  async getCredentials(merchantId: string): Promise<StoredCredentials | null> {
    const row = await this.db
      .selectFrom('ucCredentials')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) return null;

    return {
      username: row.ratioUsername,
      password: this.crypto.decrypt(row.passwordEnc),
      ucUsername: row.ucUsername,
      lastInboundCallAt: row.lastInboundCallAt,
    };
  }

  async touchInboundCall(merchantId: string): Promise<void> {
    await this.db
      .updateTable('ucCredentials')
      .set({ lastInboundCallAt: new Date() })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async touchStatusNotification(merchantId: string): Promise<void> {
    await this.db
      .updateTable('ucCredentials')
      .set({ lastStatusNotificationAt: new Date() })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async getStatus(merchantId: string): Promise<'active' | 'paused' | 'uninstalled' | null> {
    const row = await this.db
      .selectFrom('ucCredentials')
      .select('status')
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    return row?.status ?? null;
  }

  async pause(merchantId: string): Promise<void> {
    await this.db
      .updateTable('ucCredentials')
      .set({ status: 'paused' })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async unpause(merchantId: string): Promise<void> {
    await this.db
      .updateTable('ucCredentials')
      .set({ status: 'active' })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async getUcUsername(merchantId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('ucCredentials')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    return row?.ucUsername ?? null;
  }

  async getRatioUsername(merchantId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('ucCredentials')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    return row?.ratioUsername ?? null;
  }

  /**
   * Persists the merchant's real storefront domain, captured at OAuth install
   * time from the token response (`merchantStoreId` or the access-token JWT).
   * Read back per-merchant by the catalog pull so each merchant's `productUrl`
   * uses THEIR domain instead of the global env-var fallback (see migration
   * 0014). No-op if the merchant row doesn't exist (UPDATE matches zero rows).
   */
  async setStoreDomain(merchantId: string, domain: string): Promise<void> {
    await this.db
      .updateTable('ucCredentials')
      .set({ storeDomain: domain })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async getStoreDomain(merchantId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('ucCredentials')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    return row?.storeDomain ?? null;
  }

  /**
   * Verifies a Unicommerce-supplied username/password pair against the
   * credentials issued by `generate()`/`regenerate()`. Returns the owning
   * merchantId on success, else null — never throws on a bad password, since
   * this backs the inbound /authToken endpoint which must return
   * INVALID_CREDENTIALS rather than a 500.
   */
  async verify(username: string, password: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('ucCredentials')
      .selectAll()
      .where('ratioUsername', '=', username)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!row) return null;

    const ok = this.compareSecret(password, row.passwordEnc);
    return ok ? row.merchantId : null;
  }

  /**
   * Decrypts the stored ciphertext and compares in constant time
   * (`timingSafeEqual`) rather than `===`, so the comparison itself doesn't
   * leak timing information about how many leading bytes matched.
   */
  private compareSecret(password: string, storedPasswordEnc: string): boolean {
    let expected: Buffer;
    try {
      expected = Buffer.from(this.crypto.decrypt(storedPasswordEnc), 'utf8');
    } catch {
      return false;
    }
    const provided = Buffer.from(password, 'utf8');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }
}
