import { Inject, Injectable, Logger } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { RP_DB_TOKEN } from '../kysely.module';
import type { RpDatabase } from '../db/types';
import { hashId } from './hash-id';

export type RpIdEntityType = 'product' | 'variant';

/**
 * Reverse-lookup for the one-way hash (hash-id.ts) the adapter mints in place of OS's real
 * ids. Own database, own table — never RP's MongoDB. See migration 0003 for the full
 * rationale.
 */
@Injectable()
export class RpIdMappingService {
  private readonly logger = new Logger(`RP:${RpIdMappingService.name}`);

  constructor(@Inject(RP_DB_TOKEN) private readonly handle: KyselyClient<RpDatabase>) {}

  /**
   * Computes the hash for `realId` and persists the (entityType, hashedId) → realId mapping,
   * so a later `resolveRealId` call with this exact hash succeeds. Returns the hash so the
   * caller can use it immediately in the same response it's building for RP. Never throws —
   * a failed write only means a future reversal falls back to the still-hashed id, same as
   * before this table existed; it must never break the response actually being built.
   */
  async hashAndPersist(entityType: RpIdEntityType, realId: string): Promise<string> {
    const hashedId = hashId(realId);
    if (hashedId === '0') return hashedId;

    try {
      await this.handle.db
        .insertInto('rp_id_mappings')
        .values({ entityType, hashedId, realId })
        .onDuplicateKeyUpdate({ realId })
        .execute();
    } catch (err) {
      this.logger.error({ err, entityType, hashedId, realId }, 'failed to persist id mapping');
    }
    return hashedId;
  }

  /** Resolves a previously-minted hashed id back to the real OS id. Null if never seen. */
  async resolveRealId(entityType: RpIdEntityType, hashedId: string): Promise<string | null> {
    try {
      const row = await this.handle.db
        .selectFrom('rp_id_mappings')
        .select('realId')
        .where('entityType', '=', entityType)
        .where('hashedId', '=', hashedId)
        .executeTakeFirst();
      return row?.realId ?? null;
    } catch (err) {
      this.logger.error({ err, entityType, hashedId }, 'failed to resolve id mapping');
      return null;
    }
  }
}
