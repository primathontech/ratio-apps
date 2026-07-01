import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { RatioOAuthCreds, RatioOAuthHttp } from '../../../core/oauth/ratio-oauth.http';
import { RP_DB_TOKEN } from '../kysely.module';
import { RP_CRYPTO, RP_RATIO_OAUTH_CREDS, RP_RATIO_OAUTH_HTTP } from '../tokens';
import type { RpDatabase } from '../db/types';

/** Refresh when the stored access token has < this many ms of life left. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Resolves a valid Ratio access token for a given RP merchant.
 *
 * ⚠️ CONCURRENCY: Ratio refresh tokens are single-use. Two callers refreshing
 * the same merchant concurrently would both present the same old refresh token —
 * the second call triggers Ratio's reuse detection, invalidating the whole token
 * family until the merchant reinstalls. We prevent this with two layers:
 *
 *   1. Per-merchant in-process single-flight (cheap guard — collapses concurrent
 *      calls within the same process to one DB transaction).
 *   2. `SELECT … FOR UPDATE` row lock inside a transaction — the first caller
 *      holds the lock through the HTTP refresh + write; any other process waiting
 *      on the lock re-reads the rotated token and returns it WITHOUT refreshing.
 */
@Injectable()
export class RpRatioTokenProvider {
  /** Per-merchant in-flight refresh promises (in-process single-flight). */
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    @Inject(RP_DB_TOKEN) private readonly handle: KyselyClient<RpDatabase>,
    @Inject(RP_CRYPTO) private readonly crypto: CryptoService,
    @Inject(RP_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(RP_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
  ) {}

  async getAccessToken(merchantId: string): Promise<string> {
    // Fast path: non-locking read — common case on every RP API call.
    const row = await this.handle.db
      .selectFrom('return_prime_merchants')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (!row) throw new Error(`no RP merchant row for merchant ${merchantId}`);
    if (this.isValid(row.expiresAt)) return this.crypto.decrypt(row.accessTokenEnc);

    // Token expired or near-expiry → collapse concurrent same-merchant refreshes.
    return this.refreshSingleFlight(merchantId);
  }

  private isValid(expiresAt: Date): boolean {
    return !!expiresAt && new Date(expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
  }

  /** In-process single-flight wrapper — layer 1. */
  private refreshSingleFlight(merchantId: string): Promise<string> {
    const existing = this.inflight.get(merchantId);
    if (existing) return existing;
    const p = this.refreshWithLock(merchantId).finally(() => this.inflight.delete(merchantId));
    this.inflight.set(merchantId, p);
    return p;
  }

  /**
   * Refresh under a `SELECT … FOR UPDATE` row lock — layer 2.
   * The lock is held across the HTTP refresh + write so a concurrent caller
   * in another process blocks, then re-reads the already-rotated token and
   * returns it without calling the refresh endpoint again.
   */
  private refreshWithLock(merchantId: string): Promise<string> {
    return this.handle.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('return_prime_merchants')
        .selectAll()
        .where('merchantId', '=', merchantId)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) throw new Error(`no RP merchant row for merchant ${merchantId}`);

      // Double-check under the lock: another process may have already rotated
      // the token while we waited. Use it — do NOT refresh again.
      if (this.isValid(locked.expiresAt)) return this.crypto.decrypt(locked.accessTokenEnc);

      // Safe to spend the single-use refresh token now.
      const refreshed = await this.http.refresh(this.crypto.decrypt(locked.refreshTokenEnc), {
        clientId: this.creds.clientId,
        clientSecret: this.creds.clientSecret,
      });
      const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

      await trx
        .updateTable('return_prime_merchants')
        .set({
          accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
          refreshTokenEnc: this.crypto.encrypt(refreshed.refreshToken),
          expiresAt,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('merchantId', '=', merchantId)
        .execute();

      return refreshed.accessToken;
    });
  }
}
