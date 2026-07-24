import { HttpException, NotFoundException } from '@nestjs/common';
import { loyaltyClaimRequestSchema } from '@ratio-app/shared/schemas/loyalty-claim';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RedisService } from '../../../../src/core/cache/redis.service';
import type { LoyaltyConfigService } from '../../../../src/modules/loyalty/config/config.service';
import type { CoreLoyaltyClient } from '../../../../src/modules/loyalty/core-client/core-loyalty.client';
import { CoreLoyaltyError } from '../../../../src/modules/loyalty/core-client/core-loyalty.client';
import { ClaimSignatureService } from '../../../../src/modules/loyalty/qr/claim-signature.service';
import { QrClaimController } from '../../../../src/modules/loyalty/qr/qr-claim.controller';
import { FakeQrDb, makeFakeQrHandle } from './helpers/fake-qr-db';
import { FakeCoreLoyalty, FakeRedis, MERCHANT_ID } from './helpers/fakes';

const CODE = 'ABCDEFGH12345678';
const QR_ID = 'qr-1';
const PHONE = '+919876543210';
const SECRET = 'sek';
const req = { ip: '1.2.3.4' } as FastifyRequest;

/** Mint a valid (or deliberately stale/mis-signed) claim body. */
function signedBody(
  merchantId: string,
  qr: string,
  phone: string,
  opts: { ts?: number; secret?: string } = {},
): { merchantId: string; phone: string; ts: number; sig: string } {
  const ts = opts.ts ?? Date.now();
  const secret = opts.secret ?? SECRET;
  return {
    merchantId,
    phone,
    ts,
    sig: ClaimSignatureService.sign({ merchantId, qr, phone, ts }, secret),
  };
}

function seedQr(fake: FakeQrDb, overrides: Record<string, unknown> = {}): void {
  fake.seed('loyalty_qr_codes', [
    {
      id: QR_ID,
      merchantId: MERCHANT_ID,
      code: CODE,
      eventName: 'Launch Party',
      pointsPerScan: 50,
      maxScans: 0,
      startsAt: new Date(Date.now() - 24 * 3600_000),
      expiresAt: new Date(Date.now() + 24 * 3600_000),
      ...overrides,
    },
  ]);
}

function seedConfig(
  fake: FakeQrDb,
  claimSigningSecret: string | null = SECRET,
  merchantId = MERCHANT_ID,
): void {
  fake.seed('loyalty_configs', [{ merchantId, claimSigningSecret }]);
}

describe('QrClaimController', () => {
  let fake: FakeQrDb;
  let core: FakeCoreLoyalty;
  let redis: FakeRedis;
  let sig: ClaimSignatureService;
  let controller: QrClaimController;

  beforeEach(() => {
    const made = makeFakeQrHandle();
    fake = made.fake;
    core = new FakeCoreLoyalty();
    redis = new FakeRedis();
    sig = new ClaimSignatureService();
    const config = {
      getByMerchantId: () =>
        Promise.resolve({ programName: 'Wellversed Coins', baseEarnRate: 1, coinValueInr: 0.1 }),
    } as unknown as LoyaltyConfigService;
    controller = new QrClaimController(
      made.handle,
      redis as unknown as RedisService,
      config,
      sig,
      core as unknown as CoreLoyaltyClient,
    );
  });

  describe('GET :code/status', () => {
    it('returns render data for an active QR', async () => {
      seedQr(fake, { claimMessage: 'See you there!' });
      const res = await controller.status(CODE, req);
      expect(res).toEqual({
        state: 'active',
        eventName: 'Launch Party',
        points: 50,
        programName: 'Wellversed Coins',
        claimMessage: 'See you there!',
      });
    });

    it('404s an unknown code', async () => {
      await expect(controller.status('NOPE', req)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('429s past the per-IP limit', async () => {
      seedQr(fake);
      redis.counters.set(`loyalty:qrs:${req.ip}`, 60);
      const err = await controller.status(CODE, req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
    });
  });

  describe('POST :code/claim', () => {
    it('#rejects-old-shape — strict schema refuses the retired gkAccessToken body', () => {
      expect(loyaltyClaimRequestSchema.safeParse({ gkAccessToken: 't', phone: '123' }).success).toBe(
        false,
      );
      expect(
        loyaltyClaimRequestSchema.safeParse(signedBody(MERCHANT_ID, CODE, PHONE)).success,
      ).toBe(true);
    });

    it('#credits-once — a valid signature credits with core key qr:{id}:{phone}', async () => {
      seedQr(fake);
      seedConfig(fake);
      const res = await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);

      expect(res).toEqual({
        status: 'credited',
        points: 50,
        newBalance: 50,
        programName: 'Wellversed Coins',
      });
      expect(core.calls).toHaveLength(1);
      expect(core.calls[0]).toMatchObject({
        op: 'credit',
        merchantId: MERCHANT_ID,
        phone: PHONE,
        points: 50,
        idempotencyKey: `qr:${QR_ID}:${PHONE}`,
        description: 'Launch Party',
        metadata: { qr_code_id: QR_ID, event_name: 'Launch Party' },
      });
      const scans = fake.table('loyalty_qr_scans');
      expect(scans).toHaveLength(1);
      expect(scans[0]).toMatchObject({ qrCodeId: QR_ID, phone: PHONE, coreTransactionId: 'txn-1' });
      expect(fake.table('loyalty_qr_codes')[0].scanCount).toBe(1);
    });

    it('#second-claim-already-claimed — same phone+QR returns the live balance, credits nothing twice', async () => {
      seedQr(fake);
      seedConfig(fake);
      await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);
      const res = await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);

      expect(res).toEqual({
        status: 'already_claimed',
        balance: 50,
        programName: 'Wellversed Coins',
      });
      expect(core.calls.filter((c) => c.op === 'credit')).toHaveLength(1);
      expect(fake.table('loyalty_qr_scans')).toHaveLength(1);
      expect(fake.table('loyalty_qr_codes')[0].scanCount).toBe(1);
    });

    it('#bad-signature — a tampered sig is rejected, no Core call', async () => {
      seedQr(fake);
      seedConfig(fake);
      const body = signedBody(MERCHANT_ID, CODE, PHONE);
      const flipped = body.sig.endsWith('0') ? '1' : '0';
      const res = await controller.claim(CODE, { ...body, sig: `${body.sig.slice(0, -1)}${flipped}` }, req);
      expect(res).toEqual({ status: 'invalid_signature' });
      expect(core.calls).toHaveLength(0);
    });

    it('#wrong-merchant-secret — a signature signed with another merchant’s secret is rejected', async () => {
      seedQr(fake);
      seedConfig(fake, 'the-real-secret');
      const res = await controller.claim(
        CODE,
        signedBody(MERCHANT_ID, CODE, PHONE, { secret: 'attacker-guessed-secret' }),
        req,
      );
      expect(res).toEqual({ status: 'invalid_signature' });
      expect(core.calls).toHaveLength(0);
    });

    it('#stale-timestamp — a timestamp older than the freshness window is rejected', async () => {
      seedQr(fake);
      seedConfig(fake);
      const staleTs = Date.now() - 6 * 60_000;
      const res = await controller.claim(
        CODE,
        signedBody(MERCHANT_ID, CODE, PHONE, { ts: staleTs }),
        req,
      );
      expect(res).toEqual({ status: 'invalid_signature' });
      expect(core.calls).toHaveLength(0);
    });

    it('#wrong-merchant-id — body.merchantId mismatching the QR owner is rejected', async () => {
      seedQr(fake);
      seedConfig(fake);
      const res = await controller.claim(CODE, signedBody('some-other-merchant', CODE, PHONE), req);
      expect(res).toEqual({ status: 'invalid_signature' });
      expect(core.calls).toHaveLength(0);
    });

    it('#no-secret-configured — a merchant with no claimSigningSecret is rejected', async () => {
      seedQr(fake);
      // No loyalty_configs row seeded at all.
      const res = await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);
      expect(res).toEqual({ status: 'invalid_signature' });
      expect(core.calls).toHaveLength(0);
    });

    it('#terminal-state — paused/expired/fully_claimed QR never reaches signature verification', async () => {
      seedQr(fake, { maxScans: 1, scanCount: 1 });
      // No config row seeded either — proves verify is never reached.
      const res = await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);
      expect(res).toEqual({ status: 'unavailable', state: 'fully_claimed' });
      expect(core.calls).toHaveLength(0);
      expect(fake.table('loyalty_qr_scans')).toHaveLength(0);
    });

    it('429s past the per-IP claim limit', async () => {
      seedQr(fake);
      seedConfig(fake);
      redis.counters.set(`loyalty:qrc:${req.ip}`, 10);
      const err = await controller
        .claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(core.calls).toHaveLength(0);
    });

    it('#new-phone-creates-mirror-row-flagged-qr', async () => {
      seedQr(fake);
      seedConfig(fake);
      await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);

      const customers = fake.table('loyalty_customers');
      expect(customers).toHaveLength(1);
      expect(customers[0]).toMatchObject({
        merchantId: MERCHANT_ID,
        phone: PHONE,
        firstSeenSource: 'qr',
        pointsBalance: 50, // mirror refreshed from the credit response
      });
      expect(fake.table('loyalty_qr_scans')[0].isNewPhone).toBe(true);
      expect(fake.table('loyalty_qr_codes')[0].newPhoneCount).toBe(1);
    });

    it('existing phone is not flagged new and keeps its firstSeenSource', async () => {
      seedQr(fake);
      seedConfig(fake);
      fake.seed('loyalty_customers', [
        { merchantId: MERCHANT_ID, phone: PHONE, firstSeenSource: 'order' },
      ]);
      await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);

      const customers = fake.table('loyalty_customers');
      expect(customers).toHaveLength(1);
      expect(customers[0].firstSeenSource).toBe('order');
      expect(fake.table('loyalty_qr_scans')[0].isNewPhone).toBe(false);
      expect(fake.table('loyalty_qr_codes')[0].newPhoneCount).toBe(0);
    });

    it('core failure deletes the scan, restores counters, and rethrows', async () => {
      seedQr(fake);
      seedConfig(fake);
      core.failOn.set(PHONE, new CoreLoyaltyError('upstream_error', 502, 'core loyalty 502'));

      await expect(
        controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req),
      ).rejects.toBeInstanceOf(CoreLoyaltyError);
      expect(fake.table('loyalty_qr_scans')).toHaveLength(0);
      expect(fake.table('loyalty_qr_codes')[0].scanCount).toBe(0);
      expect(fake.table('loyalty_qr_codes')[0].newPhoneCount).toBe(0);
    });

    it('max-scans race — over-admitted scan is compensated as fully_claimed', async () => {
      // State check sees scanCount 0 < maxScans 1 (active), then a concurrent
      // claim wins the last slot before ours lands: simulate by bumping the
      // counter during signature verification (which runs between the two
      // reads: the initial qr fetch and the post-update "fresh" read).
      seedQr(fake, { maxScans: 1, scanCount: 0 });
      seedConfig(fake);
      const realVerify = sig.verify.bind(sig);
      sig.verify = (input) => {
        fake.table('loyalty_qr_codes')[0].scanCount = 1;
        return realVerify(input);
      };

      const res = await controller.claim(CODE, signedBody(MERCHANT_ID, CODE, PHONE), req);

      expect(res).toEqual({ status: 'unavailable', state: 'fully_claimed' });
      expect(core.calls).toHaveLength(0); // never reached Core
      expect(fake.table('loyalty_qr_scans')).toHaveLength(0); // our scan compensated
      expect(fake.table('loyalty_qr_codes')[0].scanCount).toBe(1); // concurrent winner kept
    });

    it('404s an unknown code', async () => {
      await expect(
        controller.claim('NOPE', signedBody(MERCHANT_ID, 'NOPE', PHONE), req),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
