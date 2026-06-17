import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  TemplateConfig,
  TemplateConfigInput,
} from '@ratio-app/shared/schemas/_template-config';
import { buildDefaultEventMap } from '@ratio-app/shared/schemas/event-map';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { TemplateDatabase } from '../db/types';
import { TEMPLATE_DB_TOKEN } from '../kysely.module';

/**
 * Per-merchant Template config CRUD. Backed by `_template_configs`, keyed by
 * `merchant_id` (single-tenant per-module DB — no `app` column).
 *
 * MySQL has no `RETURNING`, so writes use the INSERT…ON DUPLICATE KEY UPDATE
 * + follow-up SELECT pattern.
 */
@Injectable()
export class TemplateConfigService {
  constructor(@Inject(TEMPLATE_DB_TOKEN) private readonly handle: KyselyClient<TemplateDatabase>) {}

  async getByMerchantId(merchantId: string): Promise<TemplateConfig> {
    const row = await this.handle.db
      .selectFrom('_template_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'no _template config for merchant',
        error_code: 'CONFIG_NOT_FOUND',
      });
    }
    return {
      apiKey: row.apiKey,
      host: row.host,
      // MySQL stores `debug` as TINYINT(1) → mysql2 returns 0/1, coerce.
      debug: Boolean(row.debug),
      events: row.events,
    };
  }

  /**
   * UPSERT this merchant's Template config and return the saved shape.
   *
   * Compose the response in memory from the validated input — no follow-up
   * SELECT. We have the exact values we just wrote; the only DB-side
   * mutations are `updatedAt`/`createdAt` which the API contract doesn't
   * expose. Saves one MySQL round trip per write.
   *
   * If a caller ever needs server-side timestamps back, call
   * {@link getByMerchantId} directly after this returns.
   */
  async upsert(merchantId: string, input: TemplateConfigInput): Promise<TemplateConfig> {
    const events = input.events ?? buildDefaultEventMap();
    const debug = input.debug ?? false;
    // mysql2 does NOT auto-serialize objects into JSON columns. Encode here.
    const eventsJson = JSON.stringify(events);

    await this.handle.db
      .insertInto('_template_configs')
      .values({
        merchantId,
        apiKey: input.apiKey,
        host: input.host,
        debug,
        events: eventsJson as unknown as typeof events,
      })
      .onDuplicateKeyUpdate({
        apiKey: input.apiKey,
        host: input.host,
        debug,
        events: eventsJson as unknown as typeof events,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .execute();

    return {
      apiKey: input.apiKey,
      host: input.host,
      debug,
      events,
    };
  }
}
