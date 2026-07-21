import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  type LoyaltyCustomerFilters,
  loyaltyCustomerFiltersSchema,
} from '@ratio-app/shared/schemas/loyalty-export';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { ulid } from 'ulid';
import { type ZodType, z } from 'zod';
import { CurrentMerchant } from '../../../core/common/decorators/merchant.decorator';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { normalizePhone } from '../common/normalize-phone';
import type {
  CoreBalanceResponse,
  CoreHistoryResponse,
  CoreLoyaltyClient,
} from '../core-client/core-loyalty.client';
import type { LoyaltyCustomerRow, LoyaltyDatabase } from '../db/types';
import { LoyaltyMerchantTokenGuard } from '../guards';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { CustomerQueryService } from '../mirror/customer-query.service';
import type { LoyaltyCustomerSort } from '../mirror/customer-query.types';
import { LOYALTY_CORE_CLIENT } from '../tokens';

const SORTS: readonly LoyaltyCustomerSort[] = [
  'points_balance',
  'lifetime_earned',
  'lifetime_spend',
  'lifetime_orders',
  'last_order_at',
];

const adjustInputSchema = z.object({
  direction: z.enum(['credit', 'debit']),
  points: z.coerce.number().int().min(1).max(100_000),
  reason: z.string().min(1).max(500),
});

export type AdjustInput = z.infer<typeof adjustInputSchema>;

/**
 * Merchant-facing customer reads over the mirror + live Core Loyalty data,
 * plus manual credit/debit adjustments. Every phone that reaches the DB or a
 * Core call goes through {@link normalizePhone} (one loyalty identity per
 * customer — TRD §8 risk 2).
 */
@Controller('loyalty/api/customers')
@UseGuards(LoyaltyMerchantTokenGuard)
export class LoyaltyCustomersController {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly customerQuery: CustomerQueryService,
    @Inject(LOYALTY_CORE_CLIENT) private readonly core: CoreLoyaltyClient,
  ) {}

  /** Mirror query: AND-joined filters + sort + pagination (export preview, leaderboard, search). */
  @Get()
  async list(
    @CurrentMerchant() merchant: Merchant,
    @Query('filters') filtersRaw?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{ rows: LoyaltyCustomerRow[]; total: number }> {
    const filters = this.parseFilters(filtersRaw);
    const sortKey: LoyaltyCustomerSort = SORTS.includes(sort as LoyaltyCustomerSort)
      ? (sort as LoyaltyCustomerSort)
      : 'points_balance';
    return this.customerQuery.page(merchant.id, filters, {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      sort: sortKey,
    });
  }

  /** Profile = mirror row + LIVE Core balance/history; refreshes the mirror. */
  @Get(':phone')
  async profile(
    @CurrentMerchant() merchant: Merchant,
    @Param('phone') rawPhone: string,
  ): Promise<{
    profile: LoyaltyCustomerRow;
    balance: CoreBalanceResponse;
    history: CoreHistoryResponse;
  }> {
    const phone = this.requirePhone(rawPhone);
    const row = await this.handle.db
      .selectFrom('loyalty_customers')
      .selectAll()
      .where('merchantId', '=', merchant.id)
      .where('phone', '=', phone)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'customer not found',
        error_code: 'CUSTOMER_NOT_FOUND',
      });
    }

    const [balance, history] = await Promise.all([
      this.core.balance(merchant.id, phone),
      this.core.history(merchant.id, phone),
    ]);

    const balanceSyncedAt = new Date();
    const balanceFields = {
      pointsBalance: balance.points_balance,
      lifetimeEarned: balance.points_earned_lifetime,
      lifetimeRedeemed: balance.points_redeemed_lifetime,
      lifetimeExpired: balance.points_expired_lifetime,
      lifetimeAdjusted: balance.points_adjusted_lifetime,
    };
    await this.handle.db
      .updateTable('loyalty_customers')
      .set({ ...balanceFields, balanceSyncedAt })
      .where('merchantId', '=', merchant.id)
      .where('phone', '=', phone)
      .execute();

    return { profile: { ...row, ...balanceFields, balanceSyncedAt }, balance, history };
  }

  /** Manual credit/debit — debits are pre-checked against the LIVE balance. */
  @Post(':phone/adjust')
  async adjust(
    @CurrentMerchant() merchant: Merchant,
    @Param('phone') rawPhone: string,
    @Body(new ZodValidationPipe(adjustInputSchema as unknown as ZodType<AdjustInput>))
    body: AdjustInput,
  ): Promise<{ direction: AdjustInput['direction']; points: number; newBalance: number }> {
    const phone = this.requirePhone(rawPhone);

    if (body.direction === 'debit') {
      // Precheck BEFORE any write — a doomed debit never reaches the ledger.
      const balance = await this.core.balance(merchant.id, phone);
      if (balance.points_balance < body.points) {
        throw new UnprocessableEntityException({
          message: 'customer balance is lower than the requested debit',
          error_code: 'INSUFFICIENT_BALANCE',
        });
      }
    }

    const input = {
      merchantId: merchant.id,
      phone,
      points: body.points,
      idempotencyKey: `manual:${ulid()}`,
      description: body.reason,
      metadata: { source: 'manual_adjustment' },
    };
    const result =
      body.direction === 'credit' ? await this.core.credit(input) : await this.core.debit(input);

    await this.handle.db
      .updateTable('loyalty_customers')
      .set({ pointsBalance: result.new_balance, balanceSyncedAt: new Date() })
      .where('merchantId', '=', merchant.id)
      .where('phone', '=', phone)
      .execute();

    return { direction: body.direction, points: body.points, newBalance: result.new_balance };
  }

  private requirePhone(raw: string): string {
    const phone = normalizePhone(raw);
    if (!phone) {
      throw new BadRequestException({
        message: 'not a valid Indian mobile number',
        error_code: 'INVALID_PHONE',
      });
    }
    return phone;
  }

  private parseFilters(filtersRaw?: string): LoyaltyCustomerFilters {
    if (!filtersRaw) return [];
    let json: unknown;
    try {
      json = JSON.parse(filtersRaw);
    } catch {
      throw new BadRequestException({
        message: 'filters must be a JSON array',
        error_code: 'INVALID_FILTERS',
      });
    }
    const parsed = loyaltyCustomerFiltersSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'invalid filters',
        error_code: 'INVALID_FILTERS',
        details: parsed.error.flatten(),
      });
    }
    return parsed.data;
  }
}
