import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_CLEVERTAP_REGION } from '@ratio-app/shared/constants/clevertap-events';
import { buildDefaultEventMap, type EventMap } from '@ratio-app/shared/schemas/event-map';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { ClevertapDatabase } from './db/types';

@Injectable()
export class ClevertapBootstrap implements AppBootstrap<ClevertapDatabase> {
  private readonly logger = new Logger(ClevertapBootstrap.name);

  async run(trx: Transaction<ClevertapDatabase>, merchantId: string): Promise<void> {
    const eventsJson = JSON.stringify(buildDefaultEventMap('clevertap'));

    await trx
      .insertInto('clevertap_configs')
      .values({
        merchantId,
        accountId: '',
        passcodeEnc: null,
        region: DEFAULT_CLEVERTAP_REGION,
        serverEventsEnabled: false,
        debug: false,
        clevertapEnabled: true,
        events: eventsJson as unknown as EventMap,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();

    this.logger.log({ msg: 'clevertap config seeded', merchantId });
  }
}
