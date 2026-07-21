import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  type LoyaltyClaimRequest,
  type LoyaltyClaimResponse,
  type LoyaltyQrStatus,
  loyaltyClaimRequestSchema,
} from '@ratio-app/shared/schemas/loyalty-claim';
import type { FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { RedisService } from '../../../core/cache/redis.service';
import { ZodValidationPipe } from '../../../core/common/pipes/zod-validation.pipe';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { LoyaltyConfigService } from '../config/config.service';
import type { CoreLoyaltyClient, CorePointsResponse } from '../core-client/core-loyalty.client';
import type { GokwikIdentityClient } from '../core-client/gokwik-identity.client';
import type { LoyaltyDatabase, LoyaltyQrCodeRow } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { LOYALTY_CORE_CLIENT, LOYALTY_GK_IDENTITY } from '../tokens';
import { qrStateFor } from './qr.service';

/** Status renders: 60/IP/min. Claims: 10/IP/min (TRD §2). */
const STATUS_LIMIT = 60;
const CLAIM_LIMIT = 10;
const WINDOW_SECONDS = 60;

/**
 * PUBLIC QR claim endpoints — no merchant guard; identity comes exclusively
 * from the KwikPass `gkAccessToken` verified server-side against the GoKwik
 * profile API. The request schema is `.strict()`, so a client-supplied
 * `phone` is rejected outright (never silently ignored).
 *
 * One-claim-per-phone is enforced by the DB unique index on
 * `(qr_code_id, phone)` via INSERT IGNORE — correctness never depends on
 * Redis. Counters move with atomic `SET x = x + 1`; an over-admitted scan
 * under a max-scans race is compensated (scan deleted, counters restored).
 */
@Controller('loyalty/qr')
export class QrClaimController {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly redis: RedisService,
    private readonly config: LoyaltyConfigService,
    @Inject(LOYALTY_GK_IDENTITY) private readonly gk: GokwikIdentityClient,
    @Inject(LOYALTY_CORE_CLIENT) private readonly core: CoreLoyaltyClient,
  ) {}

  @Get(':code/status')
  async status(@Param('code') code: string, @Req() req: FastifyRequest): Promise<LoyaltyQrStatus> {
    await this.rateLimit(`loyalty:qrs:${req.ip}`, STATUS_LIMIT);
    const qr = await this.qrByCode(code);
    return {
      state: qrStateFor(qr),
      eventName: qr.eventName,
      points: qr.pointsPerScan,
      programName: await this.programName(qr.merchantId),
      ...(qr.claimMessage ? { claimMessage: qr.claimMessage } : {}),
    };
  }

  @Post(':code/claim')
  async claim(
    @Param('code') code: string,
    @Body(
      new ZodValidationPipe(loyaltyClaimRequestSchema as unknown as ZodType<LoyaltyClaimRequest>),
    )
    body: LoyaltyClaimRequest,
    @Req() req: FastifyRequest,
  ): Promise<LoyaltyClaimResponse> {
    await this.rateLimit(`loyalty:qrc:${req.ip}`, CLAIM_LIMIT);
    const qr = await this.qrByCode(code);

    const state = qrStateFor(qr);
    if (state !== 'active') return { status: 'unavailable', state };

    // The ONLY identity source — a non-verifiable token is a generic
    // invalid_session (no oracle about why).
    const customer = await this.gk.verify(body.gkAccessToken, qr.merchantId);
    if (!customer) return { status: 'invalid_session' };
    const { phone } = customer;

    const programName = await this.programName(qr.merchantId);
    const db = this.handle.db;

    // New-to-loyalty mirror row (INSERT IGNORE keeps an existing row intact).
    const ensured = await db
      .insertInto('loyalty_customers')
      .ignore()
      .values({
        merchantId: qr.merchantId,
        phone,
        firstSeenSource: 'qr',
        name: customer.name ?? null,
        email: customer.email ?? null,
      })
      .executeTakeFirst();
    const isNew = Number(ensured.numInsertedOrUpdatedRows ?? 0) > 0;
    if (!isNew && (customer.name || customer.email)) {
      await this.backfillProfile(qr.merchantId, phone, customer.name, customer.email);
    }

    // One scan per phone — the unique index is the source of truth.
    const scanInsert = await db
      .insertInto('loyalty_qr_scans')
      .ignore()
      .values({ qrCodeId: qr.id, merchantId: qr.merchantId, phone, isNewPhone: isNew })
      .executeTakeFirst();
    if (Number(scanInsert.numInsertedOrUpdatedRows ?? 0) === 0) {
      const balance = await this.core.balance(qr.merchantId, phone);
      return { status: 'already_claimed', balance: balance.points_balance, programName };
    }

    // Atomic counter moves — never read-modify-write.
    await db
      .updateTable('loyalty_qr_codes')
      .set((eb) => ({
        scanCount: eb('scanCount', '+', 1),
        ...(isNew ? { newPhoneCount: eb('newPhoneCount', '+', 1) } : {}),
      }))
      .where('id', '=', qr.id)
      .execute();

    // Max-scans race: if a concurrent claim pushed us over the cap, undo ours.
    if (qr.maxScans > 0) {
      const fresh = await db
        .selectFrom('loyalty_qr_codes')
        .select(['scanCount'])
        .where('id', '=', qr.id)
        .executeTakeFirst();
      if (fresh && Number(fresh.scanCount) > qr.maxScans) {
        await this.compensate(qr, phone, isNew);
        return { status: 'unavailable', state: 'fully_claimed' };
      }
    }

    let credit: CorePointsResponse;
    try {
      credit = await this.core.credit({
        merchantId: qr.merchantId,
        phone,
        points: qr.pointsPerScan,
        idempotencyKey: `qr:${qr.id}:${phone}`,
        description: qr.eventName,
        metadata: { qr_code_id: qr.id, event_name: qr.eventName },
      });
    } catch (err) {
      // Core failed — the scan never happened. Undo, then surface the error
      // (never a silent drop; the client can retry, the credit key is stable).
      await this.compensate(qr, phone, isNew);
      throw err;
    }

    await db
      .updateTable('loyalty_qr_scans')
      .set({ coreTransactionId: credit.transaction_id })
      .where('qrCodeId', '=', qr.id)
      .where('phone', '=', phone)
      .execute();
    await db
      .updateTable('loyalty_customers')
      .set({ pointsBalance: credit.new_balance })
      .where('merchantId', '=', qr.merchantId)
      .where('phone', '=', phone)
      .execute();

    return {
      status: 'credited',
      points: qr.pointsPerScan,
      newBalance: credit.new_balance,
      programName,
    };
  }

  private async rateLimit(key: string, limit: number): Promise<void> {
    if (!(await this.redis.allow(key, limit, WINDOW_SECONDS))) {
      throw new HttpException(
        { message: 'too many requests', error_code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async qrByCode(code: string): Promise<LoyaltyQrCodeRow> {
    const row = await this.handle.db
      .selectFrom('loyalty_qr_codes')
      .selectAll()
      .where('code', '=', code)
      .limit(1)
      .executeTakeFirst();
    // Generic 404 — no oracle distinguishing unknown vs deleted codes.
    if (!row) {
      throw new NotFoundException({ message: 'QR code not found', error_code: 'QR_NOT_FOUND' });
    }
    return row;
  }

  private async programName(merchantId: string): Promise<string> {
    try {
      return (await this.config.getByMerchantId(merchantId)).programName;
    } catch {
      return 'Coins';
    }
  }

  /** Fill name/email only where the mirror still has NULL — never overwrite. */
  private async backfillProfile(
    merchantId: string,
    phone: string,
    name?: string,
    email?: string,
  ): Promise<void> {
    const row = await this.handle.db
      .selectFrom('loyalty_customers')
      .select(['name', 'email'])
      .where('merchantId', '=', merchantId)
      .where('phone', '=', phone)
      .executeTakeFirst();
    if (!row) return;
    const patch: { name?: string; email?: string } = {};
    if (row.name === null && name) patch.name = name;
    if (row.email === null && email) patch.email = email;
    if (Object.keys(patch).length === 0) return;
    await this.handle.db
      .updateTable('loyalty_customers')
      .set(patch)
      .where('merchantId', '=', merchantId)
      .where('phone', '=', phone)
      .execute();
  }

  /** Undo an admitted-then-rejected scan: delete the row, restore counters. */
  private async compensate(qr: LoyaltyQrCodeRow, phone: string, isNew: boolean): Promise<void> {
    await this.handle.db
      .deleteFrom('loyalty_qr_scans')
      .where('qrCodeId', '=', qr.id)
      .where('phone', '=', phone)
      .execute();
    await this.handle.db
      .updateTable('loyalty_qr_codes')
      .set((eb) => ({
        scanCount: eb('scanCount', '-', 1),
        ...(isNew ? { newPhoneCount: eb('newPhoneCount', '-', 1) } : {}),
      }))
      .where('id', '=', qr.id)
      .execute();
  }
}
