import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { UC_DB_TOKEN } from '../kysely.module';
import type { UnicommerceDatabase } from '../db/types';

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class UcCircuitBreakerService {
  private readonly logger = new Logger(UcCircuitBreakerService.name);

  constructor(
    @Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>,
  ) {}

  async recordFailure(merchantId: string): Promise<boolean> {
    const now = new Date();
    const existing = await this.handle.db
      .selectFrom('uc_circuit_breaker')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (existing && existing.tripped) {
      return true;
    }

    if (existing && existing.lastFailureAt) {
      const windowStart = new Date(now.getTime() - WINDOW_MS);
      if (existing.lastFailureAt < windowStart) {
        await this.handle.db
          .updateTable('uc_circuit_breaker')
          .set({
            failureCount: 1,
            lastFailureAt: now,
            updatedAt: sql`CURRENT_TIMESTAMP(3)`,
          })
          .where('merchantId', '=', merchantId)
          .execute();
        return false;
      }

      const newCount = existing.failureCount + 1;
      if (newCount >= MAX_FAILURES) {
        await this.handle.db
          .updateTable('uc_circuit_breaker')
          .set({
            failureCount: newCount,
            lastFailureAt: now,
            tripped: true,
            trippedAt: now,
            updatedAt: sql`CURRENT_TIMESTAMP(3)`,
          })
          .where('merchantId', '=', merchantId)
          .execute();
        this.logger.warn({ msg: 'circuit breaker tripped', merchantId, failures: newCount });
        return true;
      }

      await this.handle.db
        .updateTable('uc_circuit_breaker')
        .set({
          failureCount: newCount,
          lastFailureAt: now,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('merchantId', '=', merchantId)
        .execute();
      return false;
    }

    if (existing) {
      await this.handle.db
        .updateTable('uc_circuit_breaker')
        .set({
          failureCount: existing.failureCount + 1,
          lastFailureAt: now,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('merchantId', '=', merchantId)
        .execute();
      return false;
    }

    await this.handle.db
      .insertInto('uc_circuit_breaker')
      .values({
        merchantId,
        failureCount: 1,
        lastFailureAt: now,
        tripped: false,
      })
      .execute();
    return false;
  }

  async recordSuccess(merchantId: string): Promise<void> {
    await this.handle.db
      .updateTable('uc_circuit_breaker')
      .set({
        failureCount: 0,
        lastFailureAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .execute();
  }

  async isTripped(merchantId: string): Promise<boolean> {
    const row = await this.handle.db
      .selectFrom('uc_circuit_breaker')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    return row?.tripped ?? false;
  }

  async reset(merchantId: string): Promise<void> {
    await this.handle.db
      .updateTable('uc_circuit_breaker')
      .set({
        tripped: false,
        failureCount: 0,
        lastFailureAt: null,
        trippedAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('merchantId', '=', merchantId)
      .execute();
  }
}
