import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { WizzyDatabase } from '../db/types';
import { WIZZY_DB_TOKEN } from '../kysely.module';
import { WIZZY_CRYPTO } from '../tokens';
import { ScriptTagApiError, ScriptTagClient } from './script-tag.client';

type ScriptTagStatus = 'active' | 'pending_api' | 'error' | 'disabled';

/**
 * Registers / updates / deletes the Wizzy SDK ScriptTag via the (Draft)
 * ScriptTag API. GUARDED: when the API is unavailable, the merchant's
 * `script_tag_status` becomes `pending_api` (NOT an error) so the catalog
 * sync path keeps working. A scope/token problem records `error`.
 *
 * Mirrors google's PixelRegistrationService pattern exactly.
 */
@Injectable()
export class SdkRegistrationService {
  private readonly logger = new Logger(SdkRegistrationService.name);

  constructor(
    @Inject(WIZZY_DB_TOKEN) private readonly handle: KyselyClient<WizzyDatabase>,
    @Inject(WIZZY_CRYPTO) private readonly crypto: CryptoService,
    @Inject('WIZZY_SCRIPT_TAG_CLIENT') private readonly scriptTag: ScriptTagClient,
  ) {}

  /** Attempt to register (or update) the SDK script tag for a merchant. Never throws. */
  async registerOrUpdate(merchantId: string): Promise<void> {
    const config = await this.handle.db
      .selectFrom('wizzy_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!config?.wizzyEnabled) return;

    const tokenRow = await this.handle.db
      .selectFrom('oauth_tokens')
      .select(['accessTokenEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!tokenRow) return;
    const accessToken = this.crypto.decrypt(tokenRow.accessTokenEnc);

    const src = config.sdkUrl;

    try {
      if (config.scriptTagId) {
        // Update existing tag.
        await this.scriptTag.update(accessToken, config.scriptTagId, src);
        await this.setStatus(merchantId, 'active', config.scriptTagId);
      } else {
        // Register new tag.
        const { scriptTagId } = await this.scriptTag.register(accessToken, src);
        await this.setStatus(merchantId, 'active', scriptTagId);
      }
    } catch (err) {
      const status: ScriptTagStatus =
        err instanceof ScriptTagApiError && err.kind === 'unavailable' ? 'pending_api' : 'error';
      if (status === 'pending_api') {
        this.logger.log({
          msg: 'ScriptTag API unavailable — marking pending_api',
          merchantId,
        });
      } else {
        this.logger.warn({ msg: 'ScriptTag registration failed', merchantId, err: `${err}` });
      }
      await this.setStatus(merchantId, status, null);
    }
  }

  /** Delete the SDK script tag (e.g. on uninstall or disable). Never throws. */
  async delete(merchantId: string): Promise<void> {
    const config = await this.handle.db
      .selectFrom('wizzy_configs')
      .select(['scriptTagId', 'sdkUrl'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!config?.scriptTagId) return;

    const tokenRow = await this.handle.db
      .selectFrom('oauth_tokens')
      .select(['accessTokenEnc'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!tokenRow) {
      await this.setStatus(merchantId, 'disabled', null);
      return;
    }
    const accessToken = this.crypto.decrypt(tokenRow.accessTokenEnc);

    try {
      await this.scriptTag.delete(accessToken, config.scriptTagId);
    } catch (err) {
      // Log but don't rethrow — delete is best-effort on uninstall.
      const status: ScriptTagStatus =
        err instanceof ScriptTagApiError && err.kind === 'unavailable' ? 'pending_api' : 'error';
      this.logger.warn({ msg: 'ScriptTag delete failed', merchantId, err: `${err}`, status });
    }
    await this.setStatus(merchantId, 'disabled', null);
  }

  private async setStatus(
    merchantId: string,
    status: ScriptTagStatus,
    scriptTagId: string | null,
  ): Promise<void> {
    await this.handle.db
      .updateTable('wizzy_configs')
      .set({
        scriptTagStatus: status,
        ...(scriptTagId !== null ? { scriptTagId } : { scriptTagId: null }),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      } as never)
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
