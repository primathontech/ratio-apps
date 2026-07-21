import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CoreLoyaltyClient } from '../../../../src/modules/loyalty/core-client/core-loyalty.client';
import { LoyaltyCustomersController } from '../../../../src/modules/loyalty/customers/customers.controller';
import type { CustomerQueryService } from '../../../../src/modules/loyalty/mirror/customer-query.service';
import { FakeCustomerQuery } from './helpers/fake-loyalty-db';
import { FakeQrDb, makeFakeQrHandle } from './helpers/fake-qr-db';
import { FakeCoreLoyalty, MERCHANT_ID, mkCustomer } from './helpers/fakes';

const merchant = { id: MERCHANT_ID } as Merchant;
const PHONE = '+919876543210';

describe('LoyaltyCustomersController', () => {
  let fake: FakeQrDb;
  let core: FakeCoreLoyalty;
  let query: FakeCustomerQuery;
  let controller: LoyaltyCustomersController;

  beforeEach(() => {
    const made = makeFakeQrHandle();
    fake = made.fake;
    core = new FakeCoreLoyalty();
    query = new FakeCustomerQuery([mkCustomer(), mkCustomer({ phone: '+919876543211' })]);
    controller = new LoyaltyCustomersController(
      made.handle,
      query as unknown as CustomerQueryService,
      core as unknown as CoreLoyaltyClient,
    );
  });

  describe('GET /loyalty/api/customers', () => {
    it('rejects malformed filters JSON with 400', async () => {
      await expect(controller.list(merchant, '{not json')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects schema-invalid filters with 400', async () => {
      const bad = JSON.stringify([{ field: 'nope', operator: 'gt', value: 1 }]);
      await expect(controller.list(merchant, bad)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('pages the mirror with defaults (sort points_balance, limit 20)', async () => {
      const res = await controller.list(merchant, undefined, undefined, undefined, undefined);
      expect(res.total).toBe(2);
      expect(res.rows).toHaveLength(2);
    });

    it('passes validated filters through', async () => {
      const filters = JSON.stringify([
        { field: 'points_balance', operator: 'gt', value: 100 },
        { field: 'lifetime_spend', operator: 'between', value: [100, 500] },
      ]);
      const res = await controller.list(merchant, filters, 'lifetime_earned', '1', '50');
      expect(res.total).toBe(2);
    });
  });

  describe('GET /loyalty/api/customers/:phone', () => {
    it('400s an unusable phone', async () => {
      await expect(controller.profile(merchant, 'abc')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s an unknown mirror phone', async () => {
      await expect(controller.profile(merchant, PHONE)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('#profile-merges-mirror-and-live-core + refreshes balanceSyncedAt', async () => {
      fake.seed('loyalty_customers', [
        { merchantId: MERCHANT_ID, phone: PHONE, name: 'Priya', pointsBalance: 10 },
      ]);
      core.setBalance(PHONE, 120);

      const res = await controller.profile(merchant, '9876543210'); // normalized to E.164

      expect(res.profile).toMatchObject({ phone: PHONE, name: 'Priya', pointsBalance: 120 });
      expect(res.balance.points_balance).toBe(120);
      expect(res.history).toEqual({ items: [], pagination: { page: 1, limit: 20 } });

      const row = fake.table('loyalty_customers')[0];
      expect(row.pointsBalance).toBe(120); // #profile-refreshes-mirror-balance
      expect(row.balanceSyncedAt).toBeInstanceOf(Date);
    });
  });

  describe('POST /loyalty/api/customers/:phone/adjust', () => {
    beforeEach(() => {
      fake.seed('loyalty_customers', [
        { merchantId: MERCHANT_ID, phone: PHONE, pointsBalance: 10 },
      ]);
    });

    it('debit precheck — 422 INSUFFICIENT_BALANCE before any Core write', async () => {
      core.setBalance(PHONE, 10);

      await expect(
        controller.adjust(merchant, PHONE, { direction: 'debit', points: 50, reason: 'oops' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(core.calls).toHaveLength(0); // no credit/debit ever issued
    });

    it('credit uses a manual:{ulid} idempotency key + manual_adjustment metadata', async () => {
      const res = await controller.adjust(merchant, PHONE, {
        direction: 'credit',
        points: 30,
        reason: 'goodwill',
      });

      expect(core.calls).toHaveLength(1);
      expect(core.calls[0].op).toBe('credit');
      expect(core.calls[0].idempotencyKey).toMatch(/^manual:[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(core.calls[0].metadata).toEqual({ source: 'manual_adjustment' });
      expect(core.calls[0].description).toBe('goodwill');
      expect(res.newBalance).toBe(30);
      expect(fake.table('loyalty_customers')[0].pointsBalance).toBe(30);
    });

    it('debit within balance goes through and refreshes the mirror', async () => {
      core.setBalance(PHONE, 100);

      const res = await controller.adjust(merchant, PHONE, {
        direction: 'debit',
        points: 40,
        reason: 'correction',
      });

      expect(core.calls[0].op).toBe('debit');
      expect(res.newBalance).toBe(60);
      expect(fake.table('loyalty_customers')[0].pointsBalance).toBe(60);
    });

    it('400s an unusable phone', async () => {
      await expect(
        controller.adjust(merchant, 'abc', { direction: 'credit', points: 1, reason: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
