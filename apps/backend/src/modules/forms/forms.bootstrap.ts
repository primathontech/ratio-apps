import { Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { FormsDatabase } from './db/types';

/** Seeds forms_configs launch defaults during OAuth install; ODKU self-update no-op preserves settings on reinstall without swallowing non-duplicate errors like .ignore() would. */
@Injectable()
export class FormsBootstrap implements AppBootstrap<FormsDatabase> {
  private readonly logger = new Logger(FormsBootstrap.name);

  async run(trx: Transaction<FormsDatabase>, merchantId: string): Promise<void> {
    await trx
      .insertInto('forms_configs')
      .values({
        merchantId,
        recaptchaThreshold: 0.3,
        formsEnabled: true,
      })
      .onDuplicateKeyUpdate({ merchantId: sql`merchant_id` } as never)
      .execute();
    this.logger.log({ msg: 'forms config seeded', merchantId });
  }
}
