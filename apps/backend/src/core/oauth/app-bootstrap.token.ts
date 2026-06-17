import type { Transaction } from 'kysely';

/**
 * Each module's bootstrap implements this interface and is passed to
 * `OAuthService` in the constructor. The OAuth install transaction calls
 * `run(trx, merchantId)` to seed the module's config tables.
 *
 * No DI registry symbol — each module instantiates its OAuthService with its
 * own concrete bootstrap.
 */
export interface AppBootstrap<DB> {
  run(trx: Transaction<DB>, merchantId: string): Promise<void>;
}
