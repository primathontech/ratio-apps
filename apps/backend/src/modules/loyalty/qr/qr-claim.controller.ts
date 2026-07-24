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
import type { LoyaltyDatabase, LoyaltyQrCodeRow } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import { LOYALTY_CORE_CLIENT } from '../tokens';
import { ClaimSignatureService } from './claim-signature.service';
import { qrStateFor } from './qr.service';

/** Status renders: 60/IP/min. Claims: 10/IP/min (TRD §2). */
const STATUS_LIMIT = 60;
const CLAIM_LIMIT = 10;
const WINDOW_SECONDS = 60;

/**
 * PUBLIC QR claim endpoints — no merchant guard; identity comes exclusively
 * from a per-merchant HMAC signature. The storefront BFF resolves the
 * verified phone and signs `${merchantId}.${qr}.${phone}.${ts}` with the
 * merchant's `claimSigningSecret` (see {@link ClaimSignatureService}); our
 * backend never sees a KwikPass/GoKwik token. The request schema is
 * `.strict()`, so extra client-supplied keys are rejected outright.
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
    private readonly sig: ClaimSignatureService,
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

    // The QR's true owner is authoritative — never the body's merchantId alone.
    if (body.merchantId !== qr.merchantId) return { status: 'invalid_signature' };

    const secretRow = await this.handle.db
      .selectFrom('loyalty_configs')
      .select('claimSigningSecret')
      .where('merchantId', '=', qr.merchantId)
      .limit(1)
      .executeTakeFirst();
    const secret = secretRow?.claimSigningSecret;
    if (!secret) return { status: 'invalid_signature' };

    const verdict = this.sig.verify({
      merchantId: qr.merchantId,
      qr: code,
      phone: body.phone,
      ts: body.ts,
      sig: body.sig,
      secret,
    });
    if (verdict !== 'ok') return { status: 'invalid_signature' };

    const phone = body.phone;
    const programName = await this.programName(qr.merchantId);
    const db = this.handle.db;

    // New-to-loyalty mirror row (INSERT IGNORE keeps an existing row intact).
    // Identity is signature-only now — no verified name/email to carry.
    const ensured = await db
      .insertInto('loyalty_customers')
      .ignore()
      .values({
        merchantId: qr.merchantId,
        phone,
        firstSeenSource: 'qr',
        name: null,
        email: null,
      })
      .executeTakeFirst();
    const isNew = Number(ensured.numInsertedOrUpdatedRows ?? 0) > 0;

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
