import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { GOOGLE_DB_TOKEN } from '../kysely.module';
import { GOOGLE_CRYPTO, GOOGLE_RATIO_OAUTH_CREDS, GOOGLE_RATIO_OAUTH_HTTP } from '../tokens';
import type { RatioOAuthCreds, RatioOAuthHttp } from './ratio-oauth.http';

/** Refresh when the stored access token has < this many ms of life left. */
const EXPIRY_SKEW_MS = 60_000;

type OAuthTokenRow = {
  merchantId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date | string | null;
};

/**
 * Resolves a usable Ratio (OpenStore) merchant access token for product-source
 * calls. Reads the merchant's `oauth_tokens` row; if the stored access token is
 * valid for more than {@link EXPIRY_SKEW_MS}, decrypts and returns it. Otherwise
 * it refreshes via {@link RatioOAuthHttp} and PERSISTS the rotated access AND
 * refresh tokens (re-encrypted) plus the new expiry — Ratio refresh tokens are
 * single-use, so the old one is now invalid and must be overwritten.
 *
 * ⚠️ CONCURRENCY: Ratio refresh tokens are single-use and the platform's
 * refresh-token REUSE detection invalidates the WHOLE token family if a
 * consumed refresh token is presented again. Two callers refreshing the same
 * merchant at once (e.g. the sync worker draining a webhook burst while the
 * reconcile cron fires) would both present the same old refresh token — the
 * second call's reuse kills the family, and the merchant's tokens stay dead
 * until a reinstall. We prevent that with TWO layers:
 *   1. A `SELECT … FOR UPDATE` row lock + re-check inside a transaction: the
 *      first caller holds the lock through the HTTP refresh + rotation write;
 *      any caller (in ANY process/replica sharing the DB) that was waiting
 *      then re-reads the now-rotated token and returns it WITHOUT refreshing.
 *   2. A per-merchant in-process single-flight so concurrent calls in the same
 *      process collapse to one DB transaction (the cheap guard before the lock).
 *
 * Expiry source: the `oauth_tokens.expiresAt` column.
 */
@Injectable()
export class RatioTokenProvider {
  /** Per-merchant in-flight refresh promises (in-process single-flight). */
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    @Inject(GOOGLE_CRYPTO) private readonly crypto: CryptoService,
    @Inject(GOOGLE_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(GOOGLE_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
  ) {}

  async getAccessToken(merchantId: string): Promise<string> {
    // Fast path: a non-locking read. When the token is comfortably valid we
    // return it without opening a transaction or taking a row lock — the common
    // case on every webhook/sync call.
    const row = (await this.handle.db
      .selectFrom('oauth_tokens')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst()) as OAuthTokenRow | undefined;
    if (!row) {
      throw new Error(`no Ratio oauth_tokens row for merchant ${merchantId}`);
    }
    if (this.isValid(row)) return this.crypto.decrypt(row.accessTokenEnc);

    // Needs a refresh → collapse concurrent same-merchant refreshes in this
    // process to a single transaction (layer 2).
    return this.refreshSingleFlight(merchantId);
  }

  /** True when the row's access token has more than the skew window of life left. */
  private isValid(row: OAuthTokenRow): boolean {
    return !!row.expiresAt && new Date(row.expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
  }

  /** In-process single-flight wrapper around {@link refreshWithLock}. */
  private refreshSingleFlight(merchantId: string): Promise<string> {
    const existing = this.inflight.get(merchantId);
    if (existing) return existing;
    const p = this.refreshWithLock(merchantId).finally(() => {
      this.inflight.delete(merchantId);
    });
    this.inflight.set(merchantId, p);
    return p;
  }

  /**
   * Refresh under a `SELECT … FOR UPDATE` row lock (layer 1). The lock is held
   * across the HTTP refresh + rotation write so a concurrent caller (even in a
   * different process) blocks until we commit, then re-reads the rotated token
   * via the double-check below and skips its own refresh — so the single-use
   * refresh token is presented to Ratio exactly once.
   */
  private refreshWithLock(merchantId: string): Promise<string> {
    return this.handle.db.transaction().execute(async (trx) => {
      const locked = (await trx
        .selectFrom('oauth_tokens')
        .selectAll()
        .where('merchantId', '=', merchantId)
        .forUpdate()
        .executeTakeFirst()) as OAuthTokenRow | undefined;
      if (!locked) {
        throw new Error(`no Ratio oauth_tokens row for merchant ${merchantId}`);
      }

      // Double-check under the lock: another caller (this or another process)
      // may have already rotated the token while we waited for the lock. If so,
      // use it — do NOT refresh again (that would reuse a consumed token).
      if (this.isValid(locked)) return this.crypto.decrypt(locked.accessTokenEnc);

      // We hold the lock → safe to spend the single-use refresh token.
      const refreshed = await this.http.refresh(this.crypto.decrypt(locked.refreshTokenEnc), {
        clientId: this.creds.clientId,
        clientSecret: this.creds.clientSecret,
      });
      const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

      await trx
        .updateTable('oauth_tokens')
        .set({
          accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
          refreshTokenEnc: this.crypto.encrypt(refreshed.refreshToken),
          expiresAt,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        } as never)
        .where('merchantId', '=', merchantId)
        .execute();

      return refreshed.accessToken;
    });
  }
}
