import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QueueService } from '../../../../src/core/queue/queue.service';
import { type BulkRowInput, BulkService } from '../../../../src/modules/loyalty/bulk/bulk.service';
import {
  LOYALTY_QUEUE_NAMES,
  type LoyaltyBulkMessage,
} from '../../../../src/modules/loyalty/bulk/loyalty-queues';
import { type FakeLoyaltyDb, makeFakeLoyaltyHandle } from './helpers/fake-loyalty-db';
import { FakeQueue, MERCHANT_ID } from './helpers/fakes';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** A valid, distinct Indian mobile per index (starts with 9, 10 digits). */
function phoneAt(i: number): string {
  return `9${String(100_000_000 + i)}`;
}

function mkRows(n: number, offset = 0): BulkRowInput[] {
  return Array.from({ length: n }, (_, i) => ({
    rowNumber: offset + i + 1,
    phone: phoneAt(offset + i),
    points: 10,
  }));
}

describe('BulkService', () => {
  let fake: FakeLoyaltyDb;
  let queue: FakeQueue;
  let service: BulkService;

  beforeEach(() => {
    const made = makeFakeLoyaltyHandle();
    fake = made.fake;
    queue = new FakeQueue();
    service = new BulkService(made.handle, queue as unknown as QueueService);
  });

  it('createOperation → status validating with a ULID id', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit', fileName: 'a.csv' });

    expect(op.id).toMatch(ULID_RE);
    expect(op.status).toBe('validating');
    const row = fake.table('loyalty_bulk_operations')[0];
    expect(row).toMatchObject({
      id: op.id,
      merchantId: MERCHANT_ID,
      type: 'credit',
      fileName: 'a.csv',
      status: 'validating',
    });
  });

  it('ingestRows re-validates + normalizes: invalid phone/points become failed rows with reasons', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });

    const summary = await service.ingestRows(MERCHANT_ID, op.id, [
      { rowNumber: 1, phone: '98765 43210', points: 100 },
      { rowNumber: 2, phone: 'not-a-phone', points: 50 },
      { rowNumber: 3, phone: '9876543211', points: 0 },
      { rowNumber: 4, phone: '9876543212', points: 1.5 },
      { rowNumber: 5, phone: '9876543213', points: 100_001 },
    ]);

    expect(summary).toMatchObject({ validRows: 1, invalidRows: 4 });

    const rows = fake.table('loyalty_bulk_operation_rows');
    const byNo = new Map(rows.map((r) => [r.rowNumber, r]));
    expect(byNo.get(1)).toMatchObject({ phone: '+919876543210', status: 'pending' });
    expect(byNo.get(2)).toMatchObject({ status: 'failed', errorReason: 'Invalid phone number' });
    expect(byNo.get(3)).toMatchObject({ status: 'failed', errorReason: 'Invalid amount' });
    expect(byNo.get(4)).toMatchObject({ status: 'failed', errorReason: 'Invalid amount' });
    expect(byNo.get(5)).toMatchObject({ status: 'failed', errorReason: 'Invalid amount' });

    const opRow = fake.table('loyalty_bulk_operations')[0];
    expect(opRow).toMatchObject({ totalRows: 5, validRows: 1, invalidRows: 4 });
  });

  it('rejects more than 2000 rows per ingest call', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    await expect(service.ingestRows(MERCHANT_ID, op.id, mkRows(2001))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s on a foreign-merchant op and 409s when the op is past validating', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    await expect(service.ingestRows('other-merchant', op.id, mkRows(1))).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await service.ingestRows(MERCHANT_ID, op.id, mkRows(1));
    await service.confirm(MERCHANT_ID, op.id);
    await expect(service.ingestRows(MERCHANT_ID, op.id, mkRows(1, 1))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('a retried chunk is idempotent (unique operation_id+row_number, insert .ignore())', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    const chunk = mkRows(5);

    await service.ingestRows(MERCHANT_ID, op.id, chunk);
    await service.ingestRows(MERCHANT_ID, op.id, chunk); // network retry of the same chunk

    expect(fake.table('loyalty_bulk_operation_rows')).toHaveLength(5);
    // Counters derived from actually-inserted rows — the retry adds nothing.
    const opRow = fake.table('loyalty_bulk_operations')[0];
    expect(opRow).toMatchObject({ totalRows: 5, validRows: 5, invalidRows: 0 });
  });

  it('#dup-phone-last-wins: earlier pending rows of a duplicated phone are skipped', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    await service.ingestRows(MERCHANT_ID, op.id, [
      { rowNumber: 1, phone: '9876543210', points: 10 },
      { rowNumber: 2, phone: '9876543210', points: 20 },
      { rowNumber: 3, phone: '9876543211', points: 30 },
      { rowNumber: 4, phone: '9876543210', points: 40 },
    ]);

    const summary = await service.confirm(MERCHANT_ID, op.id);

    expect(summary.duplicateWarnings).toBe(2);
    expect(summary.validRows).toBe(2);
    const rows = fake.table('loyalty_bulk_operation_rows');
    const byNo = new Map(rows.map((r) => [r.rowNumber, r]));
    expect(byNo.get(1)).toMatchObject({
      status: 'skipped',
      errorReason: 'Duplicate phone — later row wins',
    });
    expect(byNo.get(2)).toMatchObject({ status: 'skipped' });
    expect(byNo.get(3)).toMatchObject({ status: 'pending' });
    expect(byNo.get(4)).toMatchObject({ status: 'pending' }); // last occurrence wins
    expect(fake.table('loyalty_bulk_operations')[0]).toMatchObject({
      status: 'processing',
      validRows: 2,
    });
  });

  it('confirm on a non-validating status → 409 mentioning the current status', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    await service.ingestRows(MERCHANT_ID, op.id, mkRows(1));
    await service.confirm(MERCHANT_ID, op.id);

    await expect(service.confirm(MERCHANT_ID, op.id)).rejects.toThrow(/processing/);
    await expect(service.confirm(MERCHANT_ID, op.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirm enqueues pending row ids in batches of ≤500', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    await service.ingestRows(MERCHANT_ID, op.id, mkRows(600, 0));

    await service.confirm(MERCHANT_ID, op.id);

    const msgs = (queue.queues.get(LOYALTY_QUEUE_NAMES.bulkOps) ?? []).map(
      (m) => m.body as LoyaltyBulkMessage,
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ opId: op.id, merchantId: MERCHANT_ID });
    expect(msgs[0].rowIds).toHaveLength(500);
    expect(msgs[1].rowIds).toHaveLength(100);
    const all = new Set(msgs.flatMap((m) => m.rowIds));
    expect(all.size).toBe(600);
  });

  it('#error-csv-contains-failed-rows: failed + skipped rows land in the errors CSV', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'credit' });
    await service.ingestRows(MERCHANT_ID, op.id, [
      { rowNumber: 1, phone: 'bogus', points: 10, reason: 'has, comma' },
      { rowNumber: 2, phone: '9876543210', points: 10 },
      { rowNumber: 3, phone: '9876543210', points: 20 },
    ]);
    await service.confirm(MERCHANT_ID, op.id);

    const csv = await service.errorsCsv(MERCHANT_ID, op.id);
    const lines = csv.trim().split('\n');

    expect(lines[0]).toBe('row_number,phone,points,reason,error_reason');
    expect(lines).toHaveLength(3); // header + failed row 1 + skipped row 2
    expect(lines[1]).toBe('1,bogus,10,"has, comma",Invalid phone number');
    expect(lines[2]).toContain('Duplicate phone — later row wins');
    expect(csv).not.toContain('rowNumber'); // header is snake_case
  });

  it('list and get expose progress fields, merchant-scoped', async () => {
    const op = await service.createOperation(MERCHANT_ID, { type: 'debit', fileName: 'd.csv' });
    await service.ingestRows(MERCHANT_ID, op.id, mkRows(2));

    const got = await service.get(MERCHANT_ID, op.id);
    expect(got).toMatchObject({
      id: op.id,
      type: 'debit',
      status: 'validating',
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      processedRows: 0,
      successCount: 0,
      failureCount: 0,
    });

    const listed = await service.list(MERCHANT_ID, 1, 20);
    expect(listed.total).toBe(1);
    expect(listed.items[0].id).toBe(op.id);

    await expect(service.get('other-merchant', op.id)).rejects.toBeInstanceOf(NotFoundException);
    const foreign = await service.list('other-merchant', 1, 20);
    expect(foreign.items).toHaveLength(0);
  });
});
