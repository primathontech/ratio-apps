import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { UnicommerceDatabase } from './db/types';

/**
 * Runs once, inside the OAuth install transaction (OAuthService.handleCallback
 * → bootstrap.run) — matches the real `AppBootstrap<DB>` contract exactly
 * (`run(trx, merchantId)`, not a bespoke `onInstall(merchantId)`, which was a
 * pre-Task-1 mistake that only surfaced once the module was typechecked
 * end-to-end against `createAppProviders`).
 *
 * The `merchants` row itself (isActive, installedAt) is already upserted by
 * the shared OAuth install flow before `run()` is called — no need to touch
 * it here. This module has no app-specific config table to seed yet (unlike
 * e.g. `google_configs`): the merchant's Unicommerce credentials are created
 * later, by their own action on the Connect screen (Task 2), not automatically
 * on install. Kept as an explicit no-op (not omitted) so the contract this
 * module fulfills is visible, and so a future task that DOES need to seed
 * something on install has an obvious place to add it.
 */
@Injectable()
export class UnicommerceBootstrap implements AppBootstrap<UnicommerceDatabase> {
  private readonly logger = new Logger(UnicommerceBootstrap.name);

  async run(_trx: Transaction<UnicommerceDatabase>, merchantId: string): Promise<void> {
    this.logger.log({ msg: 'unicommerce install bootstrap ran (no-op, nothing to seed yet)', merchantId });
  }
}
