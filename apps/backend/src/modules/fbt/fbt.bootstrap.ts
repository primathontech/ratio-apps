import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FbtDatabase } from './db/types';

/**
 * Fbt-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Currently a no-op stub: this plan only needs `FbtDatabase` and the module
 * wiring to compile once the template's `fbt_configs` table disappears. Task
 * 4 of this plan implements the real seed — an INSERT … ON DUPLICATE KEY
 * UPDATE into `fbt_merchant_config` with its own TDD cycle.
 */
@Injectable()
export class FbtBootstrap implements AppBootstrap<FbtDatabase> {
  private readonly logger = new Logger(FbtBootstrap.name);

  async run(_trx: Transaction<FbtDatabase>, merchantId: string): Promise<void> {
    // Implemented in Task 4 of this plan.
    this.logger.log({ msg: 'fbt bootstrap (no-op pending Task 4)', merchantId });
  }
}
