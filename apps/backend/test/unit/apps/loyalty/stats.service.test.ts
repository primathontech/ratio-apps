import { beforeEach, describe, expect, it } from 'vitest';
import type { LoyaltyConfigService } from '../../../../src/modules/loyalty/config/config.service';
import { StatsService } from '../../../../src/modules/loyalty/dashboard/stats.service';
import { FakeQrDb, makeFakeQrHandle } from './helpers/fake-qr-db';
import { MERCHANT_ID } from './helpers/fakes';

function mkStatsRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    merchantId: MERCHANT_ID,
    pointsIssued: 0,
    pointsRedeemed: 0,
    pointsExpired: 0,
    bulkCredited: 0,
    bulkDebited: 0,
    qrPoints: 0,
    ruleExtraPoints: 0,
    customersWithBalance: 0,
    outstandingPoints: 0,
    ...overrides,
  };
}

const config = {
  getByMerchantId: () =>
    Promise.resolve({ programName: 'Coins', baseEarnRate: 1, coinValueInr: 0.5 }),
} as unknown as LoyaltyConfigService;

describe('StatsService', () => {
  let fake: FakeQrDb;
  let svc: StatsService;

  beforeEach(() => {
    const made = makeFakeQrHandle();
    fake = made.fake;
    svc = new StatsService(made.handle, config);
  });

  describe('#summary-tiles', () => {
    it('sums the range, computes redemption rate and ₹ liability off the latest row', async () => {
      fake.seed('loyalty_daily_stats', [
        mkStatsRow({
          statDate: '2026-07-01',
          pointsIssued: 100,
          pointsRedeemed: 20,
          pointsExpired: 5,
          customersWithBalance: 4,
          outstandingPoints: 500,
        }),
        mkStatsRow({
          statDate: '2026-07-02',
          pointsIssued: 50,
          pointsRedeemed: 25,
          customersWithBalance: 5,
          outstandingPoints: 600,
        }),
        // Outside the range — must not count.
        mkStatsRow({ statDate: '2026-06-30', pointsIssued: 999 }),
      ]);

      const res = await svc.summary(MERCHANT_ID, '2026-07-01', '2026-07-03');

      expect(res.pointsIssued).toBe(150);
      expect(res.pointsRedeemed).toBe(45);
      expect(res.pointsExpired).toBe(5);
      expect(res.redemptionRate).toBe(30); // round(45/150*1000)/10
      expect(res.customersWithBalance).toBe(5); // latest row in range
      expect(res.outstandingPoints).toBe(600);
      expect(res.liabilityInr).toBe(300); // 600 × coinValueInr 0.5
    });

    it('is all-zero (rate 0, no division blowup) on an empty range', async () => {
      const res = await svc.summary(MERCHANT_ID, '2026-07-01', '2026-07-03');
      expect(res).toEqual({
        pointsIssued: 0,
        pointsRedeemed: 0,
        pointsExpired: 0,
        redemptionRate: 0,
        customersWithBalance: 0,
        outstandingPoints: 0,
        liabilityInr: 0,
      });
    });
  });

  describe('#trend-series', () => {
    it('zero-fills missing dates across the range', async () => {
      fake.seed('loyalty_daily_stats', [
        mkStatsRow({ statDate: '2026-07-01', pointsIssued: 10, pointsRedeemed: 1 }),
        mkStatsRow({ statDate: '2026-07-03', pointsIssued: 30, pointsRedeemed: 3 }),
      ]);

      const series = await svc.trend(MERCHANT_ID, '2026-07-01', '2026-07-04');

      expect(series).toEqual([
        { date: '2026-07-01', pointsIssued: 10, pointsRedeemed: 1, pointsExpired: 0 },
        { date: '2026-07-02', pointsIssued: 0, pointsRedeemed: 0, pointsExpired: 0 },
        { date: '2026-07-03', pointsIssued: 30, pointsRedeemed: 3, pointsExpired: 0 },
        { date: '2026-07-04', pointsIssued: 0, pointsRedeemed: 0, pointsExpired: 0 },
      ]);
    });
  });

  describe('#qr-table-includes-conversion', () => {
    it('counts converted scans per QR and computes the rate', async () => {
      fake.seed('loyalty_qr_codes', [
        {
          id: 'qr-1',
          merchantId: MERCHANT_ID,
          code: 'AAAABBBBCCCCDDDD',
          eventName: 'Launch',
          pointsPerScan: 50,
          startsAt: new Date('2026-07-01T00:00:00Z'),
          expiresAt: new Date('2026-08-01T00:00:00Z'),
          scanCount: 10,
          newPhoneCount: 4,
        },
      ]);
      fake.seed('loyalty_qr_scans', [
        {
          qrCodeId: 'qr-1',
          merchantId: MERCHANT_ID,
          phone: '+919000000001',
          convertedOrderId: 'o1',
        },
        {
          qrCodeId: 'qr-1',
          merchantId: MERCHANT_ID,
          phone: '+919000000002',
          convertedOrderId: 'o2',
        },
        {
          qrCodeId: 'qr-1',
          merchantId: MERCHANT_ID,
          phone: '+919000000003',
          convertedOrderId: 'o3',
        },
        {
          qrCodeId: 'qr-1',
          merchantId: MERCHANT_ID,
          phone: '+919000000004',
          convertedOrderId: null,
        },
        {
          qrCodeId: 'qr-1',
          merchantId: MERCHANT_ID,
          phone: '+919000000005',
          convertedOrderId: null,
        },
      ]);

      const table = await svc.qrTable(MERCHANT_ID);

      expect(table).toHaveLength(1);
      expect(table[0]).toMatchObject({
        id: 'qr-1',
        eventName: 'Launch',
        scanCount: 10,
        newPhoneCount: 4,
        converted: 3,
        conversionRate: 30, // 3/10
      });
    });

    it('rate is 0 for a QR with no scans', async () => {
      fake.seed('loyalty_qr_codes', [
        {
          id: 'qr-2',
          merchantId: MERCHANT_ID,
          code: 'EEEEFFFFGGGGHHHH',
          eventName: 'Quiet',
          pointsPerScan: 10,
          startsAt: new Date('2026-07-01T00:00:00Z'),
          expiresAt: new Date('2026-08-01T00:00:00Z'),
        },
      ]);
      const table = await svc.qrTable(MERCHANT_ID);
      expect(table[0]).toMatchObject({ scanCount: 0, converted: 0, conversionRate: 0 });
    });
  });

  describe('bulkSummary', () => {
    it('sums the bulk columns and counts ops in range', async () => {
      fake.seed('loyalty_daily_stats', [
        mkStatsRow({ statDate: '2026-07-01', bulkCredited: 100, bulkDebited: 10 }),
        mkStatsRow({ statDate: '2026-07-02', bulkCredited: 50, bulkDebited: 5 }),
      ]);
      fake.seed('loyalty_bulk_operations', [
        {
          id: 'op-1',
          merchantId: MERCHANT_ID,
          type: 'credit',
          createdAt: new Date('2026-07-01T10:00:00Z'),
        },
        {
          id: 'op-2',
          merchantId: MERCHANT_ID,
          type: 'debit',
          createdAt: new Date('2026-06-01T10:00:00Z'),
        },
      ]);

      const res = await svc.bulkSummary(MERCHANT_ID, '2026-07-01', '2026-07-03');

      expect(res).toEqual({ bulkCredited: 150, bulkDebited: 15, operations: 1 });
    });
  });
});
