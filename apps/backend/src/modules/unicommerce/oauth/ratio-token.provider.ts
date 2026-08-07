import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { RatioOAuthCreds, RatioOAuthHttp } from '../../../core/oauth/ratio-oauth.http';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UC_CRYPTO, UC_RATIO_OAUTH_CREDS, UC_RATIO_OAUTH_HTTP } from '../tokens';

/** Refresh when the stored access token has < this many ms of life left. */
const EXPIRY_SKEW_MS = 60_000;

type OAuthTokenRow = {
  merchantId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date | string | null;
};

/**
 * Resolves a usable Ratio merchant access token for Unicommerce marketplace
 * calls (catalog pull, inventory push, order sync). Reads the merchant's
 * `oauth_tokens` row; if the stored access token is valid for more than
 * {@link EXPIRY_SKEW_MS}, decrypts and returns it. Otherwise it refreshes via
 * {@link RatioOAuthHttp} and PERSISTS the rotated access AND refresh tokens
 * (re-encrypted) plus the new expiry — Ratio refresh tokens are single-use, so
 * the old one is now invalid and must be overwritten.
 *
 * Mirrors `google/google-oauth/ratio-token.provider.ts`'s `RatioTokenProvider`
 * exactly — see that file's comments for the full rationale behind the two
 * layers of concurrency protection below (in-process single-flight + a
 * `SELECT ... FOR UPDATE` row lock, so concurrent refreshes across processes
 * also serialize and the single-use refresh token is never presented twice).
 *
 * Expiry source: the `oauth_tokens.expiresAt` column.
 */
@Injectable()
export class UcRatioTokenProvider {
  private readonly logger = new Logger(UcRatioTokenProvider.name);

  /** Per-merchant in-flight refresh promises (in-process single-flight). */
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
    @Inject(UC_CRYPTO) private readonly crypto: CryptoService,
    @Inject(UC_RATIO_OAUTH_HTTP) private readonly http: RatioOAuthHttp,
    @Inject(UC_RATIO_OAUTH_CREDS) private readonly creds: RatioOAuthCreds,
  ) {}

  async getAccessToken(merchantId: string): Promise<string> {
    // Fast path: a non-locking read. When the token is comfortably valid we
    // return it without opening a transaction or taking a row lock — the common
    // case on every catalog/order sync call.
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
    return this.refreshSingleFlight(merchantId, false);
  }

  /**
   * Unconditionally refreshes and returns a NEW access token, bypassing the stored
   * `expiresAt` entirely. Needed because getAccessToken's expiry check only reflects what
   * THIS environment's database last recorded — it can't detect that another
   * environment/process already refreshed (and thus invalidated) the same merchant's
   * `oauth_tokens` row before our own recorded expiry. Use this only after a genuine 401
   * from an actual upstream call (see withAuthRetry), not routinely.
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
        this.logger.log(
          { merchantId },
          'Ratio auth self-healed — forced refresh + retry succeeded',
        );
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

  /** True when the row's access token has more than the skew window of life left. */
  private isValid(row: OAuthTokenRow): boolean {
    return !!row.expiresAt && new Date(row.expiresAt).getTime() - Date.now() > EXPIRY_SKEW_MS;
  }

  /** In-process single-flight wrapper around {@link refreshWithLock}. */
  private refreshSingleFlight(merchantId: string, force: boolean): Promise<string> {
    const existing = this.inflight.get(merchantId);
    if (existing) return existing;
    const p = this.refreshWithLock(merchantId, force).finally(() => {
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
  private refreshWithLock(merchantId: string, force: boolean): Promise<string> {
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
      // Skipped entirely when `force` is true, since the whole point of
      // forceRefresh is that the stored expiresAt cannot be trusted (another
      // ENVIRONMENT, not just another process in this same DB, may have
      // already invalidated it without updating this row at all).
      if (!force && this.isValid(locked)) return this.crypto.decrypt(locked.accessTokenEnc);

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
