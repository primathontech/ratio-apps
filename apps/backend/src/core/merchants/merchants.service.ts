import type { Kysely } from 'kysely';
import type { DatabaseWithMerchants, MerchantRow } from './merchant.types';

/**
 * Library-style class. Each module instantiates one with its own typed
 * Kysely client. The class is generic over `DB extends DatabaseWithMerchants`,
 * which is the type-level guarantee that the `merchants` table exists with
 * the expected columns.
 *
 * Kysely's overloaded query builder can't resolve column-name string literals
 * against an open generic `DB`. To get proper column-level typechecking inside
 * the method bodies, we widen the receiver to `Kysely<DatabaseWithMerchants>`
 * exactly ONCE — via the private `qb` getter — and run every query against
 * that concrete view. The cast is safe because the `DB extends
 * DatabaseWithMerchants` constraint guarantees, at compile time, that every
 * column referenced below exists with the expected type.
 *
 * Today the service exposes only `findById` (used by guards/SDK to validate
 * a merchant exists + is active). Mutating operations — install UPSERT and
 * uninstall soft-delete — are inlined into their respective transactions
 * (OAuthService.handleCallback and the webhook handlers) so they participate
 * atomically with the surrounding work. Don't re-introduce write methods
 * here without first deciding how they interact with `trx`.
 */
export class MerchantsService<DB extends DatabaseWithMerchants> {
  constructor(private readonly db: Kysely<DB>) {}

  /**
   * Concrete view of `this.db` used by every query in this class. See the
   * class-level doc for why this cast is sound.
   */
  private get qb(): Kysely<DatabaseWithMerchants> {
    return this.db as unknown as Kysely<DatabaseWithMerchants>;
  }

  async findById(merchantId: string): Promise<MerchantRow | null> {
    const row = await this.qb
      .selectFrom('merchants')
      .selectAll()
      .where('id', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    return (row ?? null) as MerchantRow | null;
  }
}
