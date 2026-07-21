import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import type { S3Service } from '../../../../src/core/storage/s3.service';
import {
  LOYALTY_QUEUE_NAMES,
  type LoyaltyExportMessage,
} from '../../../../src/modules/loyalty/bulk/loyalty-queues';
import { ExportsService } from '../../../../src/modules/loyalty/exports/exports.service';
import {
  FakeCustomerQuery,
  type FakeLoyaltyDb,
  makeFakeLoyaltyHandle,
} from './helpers/fake-loyalty-db';
import { FakeQueue, FakeS3, MERCHANT_ID } from './helpers/fakes';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const res = (err as UnprocessableEntityException).getResponse() as Record<string, unknown>;
    return res.error_code as string;
  }
}

describe('ExportsService', () => {
  let fake: FakeLoyaltyDb;
  let queue: FakeQueue;
  let query: FakeCustomerQuery;
  let service: ExportsService;

  beforeEach(() => {
    const made = makeFakeLoyaltyHandle();
    fake = made.fake;
    queue = new FakeQueue();
    query = new FakeCustomerQuery();
    service = new ExportsService(made.handle, queue as unknown as QueueService, query);
  });

  it('#rejects-over-10k-without-email with error_code EMAIL_REQUIRED', async () => {
    query.countValue = 10_001;

    await expect(service.create(MERCHANT_ID, { filters: [] })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(await errorCode(service.create(MERCHANT_ID, { filters: [] }))).toBe('EMAIL_REQUIRED');

    // Same count WITH an email is accepted.
    const ok = await service.create(MERCHANT_ID, { filters: [], email: 'ops@example.com' });
    expect(ok.id).toMatch(ULID_RE);
    expect(ok.rowCountEstimate).toBe(10_001);
  });

  it('allows ≤10k rows without an email', async () => {
    query.countValue = 10_000;
    const res = await service.create(MERCHANT_ID, { filters: [] });
    expect(res.rowCountEstimate).toBe(10_000);
  });

  it('always rejects exports over 100k rows, even with an email', async () => {
    query.countValue = 100_001;
    await expect(
      service.create(MERCHANT_ID, { filters: [], email: 'ops@example.com' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(
      await errorCode(service.create(MERCHANT_ID, { filters: [], email: 'ops@example.com' })),
    ).not.toBe('EMAIL_REQUIRED');
  });

  it('create persists the filters JSON + email and enqueues a LoyaltyExportMessage', async () => {
    query.countValue = 5;
    const filters = [{ field: 'points_balance', operator: 'gt', value: 100 }];

    const res = await service.create(MERCHANT_ID, { filters, email: 'ops@example.com' });

    const row = fake.table('loyalty_exports')[0];
    expect(row).toMatchObject({
      id: res.id,
      merchantId: MERCHANT_ID,
      status: 'pending',
      email: 'ops@example.com',
    });
    expect(JSON.parse(row.filters as string)).toEqual(filters);

    const msgs = (queue.queues.get(LOYALTY_QUEUE_NAMES.exports) ?? []).map(
      (m) => m.body as LoyaltyExportMessage,
    );
    expect(msgs).toEqual([{ exportId: res.id, merchantId: MERCHANT_ID }]);
  });

  it('list/get are merchant-scoped; foreign id → 404', async () => {
    query.countValue = 1;
    const { id } = await service.create(MERCHANT_ID, { filters: [] });

    const got = await service.get(MERCHANT_ID, id);
    expect(got.id).toBe(id);
    expect(got.status).toBe('pending');

    const listed = await service.list(MERCHANT_ID, 1, 20);
    expect(listed.total).toBe(1);
    expect(listed.items[0].id).toBe(id);

    await expect(service.get('other-merchant', id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.list('other-merchant', 1, 20)).items).toHaveLength(0);
  });

  it('downloadUrl presigns 15 minutes when done, 409 before', async () => {
    const prevBucket = process.env.LOYALTY_EXPORT_S3_BUCKET;
    process.env.LOYALTY_EXPORT_S3_BUCKET = 'loyalty-bucket';
    try {
      query.countValue = 1;
      const s3 = new FakeS3();
      const { id } = await service.create(MERCHANT_ID, { filters: [] });

      await expect(
        service.downloadUrl(MERCHANT_ID, id, s3 as unknown as S3Service),
      ).rejects.toBeInstanceOf(ConflictException);

      const row = fake.table('loyalty_exports')[0];
      row.status = 'done';
      row.s3Key = `loyalty/exports/${MERCHANT_ID}/${id}.csv.gz`;

      const url = await service.downloadUrl(MERCHANT_ID, id, s3 as unknown as S3Service);
      expect(url).toBe(
        `https://s3.fake/loyalty-bucket/loyalty/exports/${MERCHANT_ID}/${id}.csv.gz?expires=900`,
      );
    } finally {
      if (prevBucket === undefined) delete process.env.LOYALTY_EXPORT_S3_BUCKET;
      else process.env.LOYALTY_EXPORT_S3_BUCKET = prevBucket;
    }
  });
});
