import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { RP_DB_TOKEN } from '../kysely.module';
import type { RpDatabase, RpMerchantRow } from '../db/types';

@Injectable()
export class RpMerchantsService {
  constructor(@Inject(RP_DB_TOKEN) private readonly handle: KyselyClient<RpDatabase>) {}

  async findByDomain(domain: string): Promise<RpMerchantRow | undefined> {
    return this.handle.db
      .selectFrom('return_prime_merchants')
      .selectAll()
      .where('domain', '=', domain)
      .where('active', '=', true)
      .executeTakeFirst();
  }

  async findByMerchantId(merchantId: string): Promise<RpMerchantRow | undefined> {
    return this.handle.db
      .selectFrom('return_prime_merchants')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
  }

  async upsert(data: {
    merchantId: string;
    domain: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.handle.db
      .insertInto('return_prime_merchants')
      .values({
        merchantId: data.merchantId,
        domain: data.domain,
        accessTokenEnc: data.accessTokenEnc,
        refreshTokenEnc: data.refreshTokenEnc,
        expiresAt: data.expiresAt,
        active: true,
      })
      .onDuplicateKeyUpdate({
        domain: data.domain,
        accessTokenEnc: data.accessTokenEnc,
        refreshTokenEnc: data.refreshTokenEnc,
        expiresAt: data.expiresAt,
        active: true,
        // A reinstall re-runs this OAuth callback and can silently reset `domain` to
        // the merchantId placeholder (see rp-auth.controller.ts) if Ratio's token
        // response doesn't carry the real domain — but rpRegistered previously stayed
        // whatever it was from the PRIOR install, so RpAdminController.me() kept
        // reporting "already registered" and the SPA never re-showed the registration
        // screen to let the merchant re-confirm/repair the real domain. Force it back
        // to false on every reinstall so registration is always re-confirmed —
        // checkExistsInRp look ups by gokwik_merchant_id (domain-independent), so this
        // safely resolves to 'login' for an existing merchant, never risking a
        // duplicate signup.
        rpRegistered: false,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();
  }

  /** Toggle the storefront Return/Exchange visibility flag (RP enable/disable → adapter). */
  async setReturnExchangeEnabled(merchantId: string, enabled: boolean): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({ returnExchangeEnabled: enabled, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  /** Flip the merchant active/inactive. Mirrors RP's own `StoreDetail.active` gate. */
  async setActive(merchantId: string, active: boolean): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({ active, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  /** Flip the merchant inactive (OS app uninstalled → adapter). */
  async deactivate(merchantId: string): Promise<void> {
    await this.setActive(merchantId, false);
  }

  async updateDomain(merchantId: string, domain: string): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({ domain, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  /**
   * Set only after RP's os-install has genuinely returned a 2xx — never as a side
   * effect of merely attempting registration. `RpAdminController.me()` reads this
   * (not `domain !== merchantId`) to decide register-vs-configured, so a failed
   * os-install can never look like a completed registration on the next page load.
   */
  async setRpRegistered(merchantId: string, registered: boolean): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({ rpRegistered: registered, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  /**
   * Persists (or, passing `null`, purges) the pre-link plan snapshot RP's os-install
   * hands back on a genuine dual-platform link. Purged on a real uninstall
   * (handleAppUninstalled) so a later fresh link has nothing stale to reuse; kept
   * across a self-service pause/resume, which never touches the dual-platform link.
   */
  async setPreviousPlan(merchantId: string, previousPlan: unknown | null): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({
        previousPlan: previousPlan == null ? null : JSON.stringify(previousPlan),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async updateTokens(
    merchantId: string,
    data: { accessTokenEnc: string; refreshTokenEnc: string; expiresAt: Date },
  ): Promise<void> {
    await this.handle.db
      .updateTable('return_prime_merchants')
      .set({
        accessTokenEnc: data.accessTokenEnc,
        refreshTokenEnc: data.refreshTokenEnc,
        expiresAt: data.expiresAt,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
