import { Injectable, Logger } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FbtDatabase } from './db/types';

/**
 * Fbt-specific install bootstrap. Runs inside the OAuth install
 * transaction (OAuthService.handleCallback → bootstrap.run).
 *
 * Implemented in Task 5 of this plan.
 */
@Injectable()
export class FbtBootstrap implements AppBootstrap<FbtDatabase> {
  private readonly logger = new Logger(FbtBootstrap.name);

  async run(_trx: Transaction<FbtDatabase>, merchantId: string): Promise<void> {
    // Implemented in Task 5 of this plan.
    this.logger.log({ msg: 'fbt bootstrap (no-op pending Task 5)', merchantId });
  }
}
