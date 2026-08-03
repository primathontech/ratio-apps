import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(`RP:${RpRatioTokenProvider.name}`);

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
    return this.refreshSingleFlight(merchantId, false);
  }

  /**
   * Unconditionally refreshes and returns a NEW access token, bypassing the stored
   * `expiresAt` entirely. Needed because getAccessToken's expiry check only reflects what
   * THIS environment's database last recorded — it can't detect that another
   * environment/process already refreshed (and thus invalidated) the same merchant's
   * credentials before our own recorded expiry. Use this only after a genuine 401 from an
   * actual upstream call (see withAuthRetry), not routinely.
   */
  async forceRefresh(merchantId: string): Promise<string> {
    return this.refreshSingleFlight(merchantId, true);
  }

  /**
   * Runs `fn` with a valid access token. If `fn` fails with a 401 from the actual Ratio
   * upstream call (not just a refresh-endpoint failure), forces exactly one token refresh
   * and retries `fn` once with the new token — self-healing the case where another
   * environment already invalidated our cached token before its own recorded expiry. If the
   * retry ALSO 401s, or the forced refresh itself fails (refresh token is genuinely dead),
   * throws one clear, distinctly-labeled error instead of leaking Ratio's raw
   * upstream/refresh failure up to the caller.
   */
  async withAuthRetry<T>(merchantId: string, fn: (accessToken: string) => Promise<T>): Promise<T> {
    const token = await this.getAccessToken(merchantId);
    try {
      return await fn(token);
    } catch (err) {
      if (!this.isUpstream401(err)) throw err;

      this.logger.warn(
        { merchantId },
        'Ratio 401 on a call with an unexpired cached token — another environment likely refreshed it early; forcing a refresh',
      );

      let freshToken: string;
      try {
        freshToken = await this.forceRefresh(merchantId);
      } catch (refreshErr) {
        this.logger.error(
          { merchantId, err: refreshErr },
          'Ratio refresh token rejected — auth is dead for this merchant, needs reinstall',
        );
        throw new Error(
          `RATIO_AUTH_DEAD_NEEDS_REINSTALL: Ratio refresh token rejected for merchant ${merchantId} — ${(refreshErr as Error).message}`,
        );
      }

      try {
        const result = await fn(freshToken);
        this.logger.log({ merchantId }, 'Ratio auth self-healed — forced refresh + retry succeeded');
        return result;
      } catch (retryErr) {
        if (this.isUpstream401(retryErr)) {
          this.logger.error(
            { merchantId },
            'Ratio still returned 401 after a forced refresh — auth is dead for this merchant, needs reinstall',
          );
          throw new Error(
            `RATIO_AUTH_DEAD_NEEDS_REINSTALL: Ratio still returned 401 for merchant ${merchantId} after a forced token refresh`,
          );
        }
        throw retryErr;
      }
    }
  }

  /**
   * True only for a 401 the actual Ratio upstream call returned. RatioClient
   * (core/ratio-client/ratio.client.ts) wraps EVERY non-2xx upstream response as a 502
   * HttpException, with the real upstream status nested in the response body's
   * `details.status` — so this must inspect that, not err.getStatus() (which is always 502).
   */
  private isUpstream401(err: unknown): boolean {
    if (!(err instanceof HttpException)) return false;
    const response = err.getResponse();
    if (typeof response !== 'object' || response === null) return false;
    const details = (response as Record<string, unknown>).details;
    if (typeof details !== 'object' || details === null) return false;
    return (details as Record<string, unknown>).status === 401;
  }

  private isValid(expiresAt: Date): boolean {
    return !!expiresAt && new Date(expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
  }

  /** In-process single-flight wrapper — layer 1. */
  private refreshSingleFlight(merchantId: string, force: boolean): Promise<string> {
    const existing = this.inflight.get(merchantId);
    if (existing) return existing;
    const p = this.refreshWithLock(merchantId, force).finally(() => this.inflight.delete(merchantId));
    this.inflight.set(merchantId, p);
    return p;
  }

  /**
   * Refresh under a `SELECT … FOR UPDATE` row lock — layer 2.
   * The lock is held across the HTTP refresh + write so a concurrent caller
   * in another process blocks, then re-reads the already-rotated token and
   * returns it without calling the refresh endpoint again.
   */
  private refreshWithLock(merchantId: string, force: boolean): Promise<string> {
    return this.handle.db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom('return_prime_merchants')
        .selectAll()
        .where('merchantId', '=', merchantId)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) throw new Error(`no RP merchant row for merchant ${merchantId}`);

      // Double-check under the lock: another process may have already rotated the token
      // while we waited. Use it — do NOT refresh again. Skipped entirely when `force` is
      // true, since the whole point of forceRefresh is that the stored expiresAt cannot be
      // trusted (another ENVIRONMENT, not just another process in this same DB, may have
      // already invalidated it without updating this row at all).
      if (!force && this.isValid(locked.expiresAt)) return this.crypto.decrypt(locked.accessTokenEnc);

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
