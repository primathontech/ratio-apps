import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';
import { UcCredentialsService } from './credentials.service';

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48h, per Unicommerce's stated contract

export type AuthResult =
  // `merchantId` is exposed here (Task 14) so the caller can attribute an
  // event-log row to a merchant without a second lookup — never returned to
  // Unicommerce itself, `auth.controller.ts` only forwards `status`/`accessToken`.
  | { status: 'SUCCESS'; accessToken: string; merchantId: string }
  | { status: 'INVALID_CREDENTIALS' };

@Injectable()
export class UcAuthService {
  constructor(
    private readonly credentials: UcCredentialsService,
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async authenticate(username: string, password: string): Promise<AuthResult> {
    const merchantId = await this.credentials.verify(username, password);
    if (!merchantId) return { status: 'INVALID_CREDENTIALS' };

    const accessToken = randomBytes(32).toString('base64url');
    await this.handle.db
      .insertInto('ucAccessTokens')
      .values({
        tokenHash: this.hashToken(accessToken),
        merchantId,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      })
      .execute();

    return { status: 'SUCCESS', accessToken, merchantId };
  }

  /**
   * No refresh-token rotation in this model — Unicommerce simply re-auths
   * from scratch via /authToken when its token lapses (confirmed contract,
   * unlike the standard Ratio-OAuth access/refresh pair used elsewhere).
   */
  async validateToken(token: string): Promise<string | null> {
    const row = await this.handle.db
      .selectFrom('ucAccessTokens')
      .selectAll()
      .where('tokenHash', '=', this.hashToken(token))
      .where('expiresAt', '>', new Date())
      .executeTakeFirst();
    return row?.merchantId ?? null;
  }
}
