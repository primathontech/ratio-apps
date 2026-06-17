import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import type {
  MoEngageConfig,
  MoEngageConfigInput,
} from '@ratio-app/shared/schemas/moengage-config';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { MoengageDatabase } from '../db/types';
import { MOENGAGE_DB_TOKEN } from '../kysely.module';

/**
 * Per-merchant MoEngage config CRUD. Backed by `moengage_configs`, keyed by
 * `merchant_id` (single-column PK now that the table lives in the MoEngage-
 * only database — no `app` column anywhere).
 *
 * MySQL has no `RETURNING`, so writes use the INSERT…ON DUPLICATE KEY UPDATE
 * + follow-up SELECT pattern (mirrored from MerchantsService).
 */
@Injectable()
export class MoengageConfigService {
  constructor(@Inject(MOENGAGE_DB_TOKEN) private readonly handle: KyselyClient<MoengageDatabase>) {}

  async getByMerchantId(merchantId: string): Promise<MoEngageConfig> {
    const row = await this.handle.db
      .selectFrom('moengage_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no moengage config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return {
      appId: row.appId,
      dataCenter: row.dataCenter as MoEngageConfig['dataCenter'],
      // MySQL stores `debug` as TINYINT(1) → mysql2 returns 0/1, coerce.
      debug: Boolean(row.debug),
      swPath: row.swPath,
      events: row.events,
    };
  }

  /**
   * UPSERT this merchant's MoEngage config and return the saved shape.
   *
   * Compose the response in memory from the validated input — no follow-up
   * SELECT. We have the exact values we just wrote; the only DB-side
   * mutations are `updatedAt`/`createdAt` which the API contract doesn't
   * expose. Saves one MySQL round trip per write.
   *
   * If a caller ever needs server-side timestamps back, call
   * {@link getByMerchantId} directly after this returns.
   */
  async upsert(merchantId: string, input: MoEngageConfigInput): Promise<MoEngageConfig> {
    const events = input.events ?? buildDefaultEventMap('moengage');
    const debug = input.debug ?? false;
    const swPath = input.swPath ?? '';
    // mysql2's driver does NOT auto-serialize JS objects into JSON columns —
    // it would send `[object Object]` and MySQL would reject with "Invalid
    // JSON text". Encode explicitly so the column gets a valid JSON literal.
    const eventsJson = JSON.stringify(events);

    await this.handle.db
      .insertInto('moengage_configs')
      .values({
        merchantId,
        appId: input.appId,
        dataCenter: input.dataCenter,
        debug,
        swPath,
        events: eventsJson as unknown as typeof events,
      })
      .onDuplicateKeyUpdate({
        appId: input.appId,
        dataCenter: input.dataCenter,
        debug,
        swPath,
        events: eventsJson as unknown as typeof events,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();

    return {
      appId: input.appId,
      dataCenter: input.dataCenter,
      debug,
      swPath,
      events,
    };
  }
}
