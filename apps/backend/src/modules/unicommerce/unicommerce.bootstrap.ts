import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { AppBootstrap } from '../../core/oauth/app-bootstrap.token';
import type { UnicommerceDatabase } from './db/types';

@Injectable()
export class UnicommerceBootstrap implements AppBootstrap<UnicommerceDatabase> {
  async run(_trx: Transaction<UnicommerceDatabase>, _merchantId: string): Promise<void> {
  }
}
