import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoyaltyConfigService } from '../../../../src/modules/loyalty/config/config.service';
import type { LoyaltyQrCodeRow } from '../../../../src/modules/loyalty/db/types';
import { QrService, qrStateFor } from '../../../../src/modules/loyalty/qr/qr.service';
import { makeFakeQrHandle } from './helpers/fake-qr-db';
import { MERCHANT_ID } from './helpers/fakes';

// A real (1x1 transparent) PNG so pdf-lib can embed what the mock returns.
const { toBufferMock, TINY_PNG } = vi.hoisted(() => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
    'base64',
  );
  return { toBufferMock: vi.fn(() => Promise.resolve(png)), TINY_PNG: png };
});

vi.mock('qrcode', () => ({ toBuffer: toBufferMock }));

const STOREFRONT = 'https://shop.example';

function makeConfig(storefrontBaseUrl?: string): LoyaltyConfigService {
  return {
    getByMerchantId: () =>
      Promise.resolve({
        programName: 'Coins',
        baseEarnRate: 1,
        coinValueInr: 0.1,
        ...(storefrontBaseUrl ? { storefrontBaseUrl } : {}),
      }),
  } as unknown as LoyaltyConfigService;
}

const VALID_INPUT = {
  eventName: 'Launch Party',
  pointsPerScan: 50,
  maxScans: 0,
  startsAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
};

function mkQrRow(overrides: Partial<LoyaltyQrCodeRow> = {}): LoyaltyQrCodeRow {
  return {
    id: 'qr-1',
    merchantId: MERCHANT_ID,
    code: 'ABCDEFGH12345678',
    eventName: 'Launch Party',
    pointsPerScan: 50,
    maxScans: 0,
    startsAt: new Date('2026-07-01T00:00:00.000Z'),
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    claimMessage: null,
    status: 'ACTIVE',
    scanCount: 0,
    newPhoneCount: 0,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  } as LoyaltyQrCodeRow;
}

describe('QrService', () => {
  beforeEach(() => {
    toBufferMock.mockClear();
  });

  describe('create', () => {
    it('creates an ACTIVE QR with a 16-char code', async () => {
      const { fake, handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));

      const created = await svc.create(MERCHANT_ID, VALID_INPUT);

      expect(created.status).toBe('ACTIVE');
      expect(created.code).toMatch(/^[0-9A-Z]{16}$/);
      expect(created.pointsPerScan).toBe(50);
      expect(fake.table('loyalty_qr_codes')).toHaveLength(1);
      expect(fake.table('loyalty_qr_codes')[0].merchantId).toBe(MERCHANT_ID);
    });

    it('#create-requires-storefront-url — 422 STOREFRONT_URL_REQUIRED without one', async () => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(undefined));

      await expect(svc.create(MERCHANT_ID, VALID_INPUT)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rejects invalid input (expiry before start) with 400', async () => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));

      await expect(
        svc.create(MERCHANT_ID, {
          ...VALID_INPUT,
          startsAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2026-07-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('get is merchant-scoped — other merchant 404s', async () => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));
      const created = await svc.create(MERCHANT_ID, VALID_INPUT);

      await expect(svc.get('other-merchant', created.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('#poster-png-encodes-claim-url-all-sizes', () => {
    it.each([300, 600, 1200])('renders size %d against the claim URL', async (size) => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));
      const created = await svc.create(MERCHANT_ID, VALID_INPUT);

      const png = await svc.posterPng(MERCHANT_ID, created.id, size);

      expect(Buffer.isBuffer(png)).toBe(true);
      expect(toBufferMock).toHaveBeenCalledWith(
        `${STOREFRONT}/?loyalty_qr=${created.code}`,
        expect.objectContaining({ width: size }),
      );
    });

    it('rejects an invalid size with 400', async () => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));
      const created = await svc.create(MERCHANT_ID, VALID_INPUT);

      await expect(svc.posterPng(MERCHANT_ID, created.id, 500)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(toBufferMock).not.toHaveBeenCalled();
    });
  });

  describe('#poster-pdf-embeds-png', () => {
    it('produces a PDF embedding the QR png', async () => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));
      const created = await svc.create(MERCHANT_ID, VALID_INPUT);

      const pdf = await svc.posterPdf(MERCHANT_ID, created.id);

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      // The PDF render always embeds a 600px QR png of the claim URL.
      expect(toBufferMock).toHaveBeenCalledWith(
        `${STOREFRONT}/?loyalty_qr=${created.code}`,
        expect.objectContaining({ width: 600 }),
      );
      await expect(toBufferMock.mock.results[0]?.value).resolves.toBe(TINY_PNG);
    });
  });

  describe('stateFor matrix', () => {
    const NOW = new Date('2026-07-15T12:00:00.000Z');

    it.each([
      ['paused', mkQrRow({ status: 'PAUSED' })],
      ['not_started', mkQrRow({ status: 'DRAFT' })],
      ['not_started', mkQrRow({ startsAt: new Date('2026-07-20T00:00:00.000Z') })],
      ['expired', mkQrRow({ status: 'EXPIRED' })],
      ['expired', mkQrRow({ expiresAt: new Date('2026-07-10T00:00:00.000Z') })],
      ['fully_claimed', mkQrRow({ maxScans: 5, scanCount: 5 })],
      ['fully_claimed', mkQrRow({ maxScans: 5, scanCount: 6 })],
      ['active', mkQrRow({ maxScans: 5, scanCount: 4 })],
      ['active', mkQrRow({ maxScans: 0, scanCount: 10_000 })],
      ['active', mkQrRow()],
    ] as const)('→ %s', (expected, row) => {
      expect(qrStateFor(row, NOW)).toBe(expected);
    });

    it('PAUSED wins over expiry, DRAFT wins over window', () => {
      expect(
        qrStateFor(mkQrRow({ status: 'PAUSED', expiresAt: new Date('2026-07-01T00:00:00Z') }), NOW),
      ).toBe('paused');
      expect(
        qrStateFor(mkQrRow({ status: 'DRAFT', startsAt: new Date('2026-07-01T00:00:00Z') }), NOW),
      ).toBe('not_started');
    });
  });

  describe('loaderSnippet', () => {
    it('embeds the callback-URL origin and the merchant id', () => {
      const { handle } = makeFakeQrHandle();
      const svc = new QrService(handle, makeConfig(STOREFRONT));
      const prev = process.env.RATIO_LOYALTY_CALLBACK_URL;
      process.env.RATIO_LOYALTY_CALLBACK_URL =
        'https://api.ratio.example/loyalty/api/v1/oauth/callback';
      try {
        expect(svc.loaderSnippet(MERCHANT_ID)).toBe(
          `<script src="https://api.ratio.example/loyalty/sdk/loyalty-loader.js?store=${MERCHANT_ID}" defer></script>`,
        );
      } finally {
        if (prev === undefined) delete process.env.RATIO_LOYALTY_CALLBACK_URL;
        else process.env.RATIO_LOYALTY_CALLBACK_URL = prev;
      }
    });
  });
});
