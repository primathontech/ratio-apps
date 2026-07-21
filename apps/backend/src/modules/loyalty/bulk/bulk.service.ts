import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import { normalizePhone } from '../common/normalize-phone';
import type {
  LoyaltyBulkOperationRow,
  LoyaltyBulkOperationType,
  LoyaltyDatabase,
} from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import {
  LOYALTY_BULK_ROWS_PER_MESSAGE,
  LOYALTY_QUEUE_NAMES,
  type LoyaltyBulkMessage,
} from './loyalty-queues';

/** Max rows per `POST /bulk-operations/:id/rows` call (TRD §2). */
const MAX_ROWS_PER_INGEST = 2_000;
const MIN_POINTS = 1;
const MAX_POINTS = 100_000;

export interface BulkRowInput {
  rowNumber: number;
  phone: string;
  points: number;
  reason?: string;
}

export interface BulkOperationSummary {
  id: string;
  type: LoyaltyBulkOperationType;
  status: string;
  fileName: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  processedRows: number;
  successCount: number;
  failureCount: number;
  createdAt: Date;
}

/**
 * Bulk credit/debit operations: create → chunked row ingest (server-side
 * re-validation + E.164 normalization) → confirm (duplicate-phone last-wins,
 * enqueue to `loyalty-bulk-ops`) → progress/errors CSV.
 *
 * Idempotency: rows carry a unique `(operation_id, row_number)` key and are
 * inserted with `INSERT IGNORE`, so a network-retried chunk adds nothing; the
 * op counters are incremented by the *actually inserted* row counts
 * (`numInsertedOrUpdatedRows`), so retries don't inflate them either.
 */
@Injectable()
export class BulkService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly queue: QueueService,
  ) {}

  async createOperation(
    merchantId: string,
    input: {
      type: LoyaltyBulkOperationType;
      fileName?: string | undefined;
      totalRows?: number | undefined;
    },
  ): Promise<BulkOperationSummary> {
    const id = ulid();
    await this.handle.db
      .insertInto('loyalty_bulk_operations')
      .values({
        id,
        merchantId,
        type: input.type,
        fileName: input.fileName ?? null,
        status: 'validating',
        // totalRows is counted from actually-ingested chunks (idempotent under
        // retry) — the client-declared value is advisory only.
      })
      .execute();
    return this.get(merchantId, id);
  }

  async ingestRows(
    merchantId: string,
    opId: string,
    rows: BulkRowInput[],
  ): Promise<{ received: number; validRows: number; invalidRows: number }> {
    if (rows.length > MAX_ROWS_PER_INGEST) {
      throw new BadRequestException({
        message: `too many rows per call (max ${MAX_ROWS_PER_INGEST})`,
        error_code: 'TOO_MANY_ROWS',
      });
    }
    const op = await this.getOpRow(merchantId, opId);
    if (op.status !== 'validating') {
      throw new ConflictException({
        message: `rows can only be added while validating — operation is '${op.status}'`,
        error_code: 'INVALID_OPERATION_STATUS',
      });
    }

    const valid: Array<Record<string, unknown>> = [];
    const invalid: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const base = {
        operationId: opId,
        rowNumber: r.rowNumber,
        points: Number.isFinite(r.points) ? r.points : 0,
        reason: r.reason ?? null,
      };
      const phone = normalizePhone(r.phone);
      if (!phone) {
        invalid.push({
          ...base,
          phone: r.phone,
          status: 'failed',
          errorReason: 'Invalid phone number',
        });
        continue;
      }
      if (!Number.isInteger(r.points) || r.points < MIN_POINTS || r.points > MAX_POINTS) {
        invalid.push({ ...base, phone, status: 'failed', errorReason: 'Invalid amount' });
        continue;
      }
      valid.push({ ...base, phone, status: 'pending' });
    }

    // INSERT IGNORE per status bucket; count what actually landed so a
    // retried chunk increments nothing.
    let insertedValid = 0;
    let insertedInvalid = 0;
    if (valid.length) {
      const res = await this.handle.db
        .insertInto('loyalty_bulk_operation_rows')
        .values(valid as never)
        .ignore()
        .executeTakeFirst();
      insertedValid = Number(res.numInsertedOrUpdatedRows ?? 0n);
    }
    if (invalid.length) {
      const res = await this.handle.db
        .insertInto('loyalty_bulk_operation_rows')
        .values(invalid as never)
        .ignore()
        .executeTakeFirst();
      insertedInvalid = Number(res.numInsertedOrUpdatedRows ?? 0n);
    }

    if (insertedValid + insertedInvalid > 0) {
      await this.handle.db
        .updateTable('loyalty_bulk_operations')
        .set((eb) => ({
          totalRows: eb('totalRows', '+', insertedValid + insertedInvalid),
          validRows: eb('validRows', '+', insertedValid),
          invalidRows: eb('invalidRows', '+', insertedInvalid),
        }))
        .where('id', '=', opId)
        .execute();
    }

    return { received: rows.length, validRows: insertedValid, invalidRows: insertedInvalid };
  }

  async confirm(
    merchantId: string,
    opId: string,
  ): Promise<BulkOperationSummary & { duplicateWarnings: number }> {
    const op = await this.getOpRow(merchantId, opId);
    if (op.status !== 'validating') {
      throw new ConflictException({
        message: `operation cannot be confirmed — current status is '${op.status}'`,
        error_code: 'INVALID_OPERATION_STATUS',
      });
    }

    const pending = await this.handle.db
      .selectFrom('loyalty_bulk_operation_rows')
      .select(['id', 'rowNumber', 'phone'])
      .where('operationId', '=', opId)
      .where('status', '=', 'pending')
      .orderBy('rowNumber', 'asc')
      .execute();

    // Duplicate-phone last-wins: keep only the highest rowNumber per phone.
    const lastRowByPhone = new Map<string, number>();
    for (const r of pending) {
      const prev = lastRowByPhone.get(r.phone);
      if (prev === undefined || r.rowNumber > prev) lastRowByPhone.set(r.phone, r.rowNumber);
    }
    const skipped = pending.filter((r) => r.rowNumber !== lastRowByPhone.get(r.phone));
    if (skipped.length) {
      await this.handle.db
        .updateTable('loyalty_bulk_operation_rows')
        .set({ status: 'skipped', errorReason: 'Duplicate phone — later row wins' })
        .where('operationId', '=', opId)
        .where('status', '=', 'pending')
        .where(
          'id',
          'in',
          skipped.map((r) => r.id),
        )
        .execute();
    }

    const winners = pending.filter((r) => r.rowNumber === lastRowByPhone.get(r.phone));
    const nextStatus = winners.length ? 'processing' : 'done';
    await this.handle.db
      .updateTable('loyalty_bulk_operations')
      .set({ status: nextStatus, validRows: winners.length, updatedAt: new Date() })
      .where('id', '=', opId)
      .execute();

    // Enqueue the pending row ids in ≤500-id batches.
    const messages: LoyaltyBulkMessage[] = [];
    for (let i = 0; i < winners.length; i += LOYALTY_BULK_ROWS_PER_MESSAGE) {
      messages.push({
        opId,
        merchantId,
        rowIds: winners.slice(i, i + LOYALTY_BULK_ROWS_PER_MESSAGE).map((r) => r.id),
      });
    }
    if (messages.length) await this.queue.sendBatch(LOYALTY_QUEUE_NAMES.bulkOps, messages);

    const summary = await this.get(merchantId, opId);
    return { ...summary, duplicateWarnings: skipped.length };
  }

  async list(
    merchantId: string,
    page: number,
    limit: number,
  ): Promise<{ items: BulkOperationSummary[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
    const rows = await this.handle.db
      .selectFrom('loyalty_bulk_operations')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit)
      .execute();
    const counted = await this.handle.db
      .selectFrom('loyalty_bulk_operations')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    return {
      items: rows.map((r) => this.toSummary(r)),
      total: Number(counted?.count ?? 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async get(merchantId: string, opId: string): Promise<BulkOperationSummary> {
    return this.toSummary(await this.getOpRow(merchantId, opId));
  }

  /** `row_number,phone,points,reason,error_reason` for failed + skipped rows. */
  async errorsCsv(merchantId: string, opId: string): Promise<string> {
    await this.getOpRow(merchantId, opId); // 404 on foreign/missing op
    const rows = await this.handle.db
      .selectFrom('loyalty_bulk_operation_rows')
      .selectAll()
      .where('operationId', '=', opId)
      .where('status', 'in', ['failed', 'skipped'])
      .orderBy('rowNumber', 'asc')
      .execute();
    const lines = ['row_number,phone,points,reason,error_reason'];
    for (const r of rows) {
      lines.push(
        [r.rowNumber, r.phone, r.points, r.reason ?? '', r.errorReason ?? '']
          .map((v) => csvEscape(String(v)))
          .join(','),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  private async getOpRow(merchantId: string, opId: string): Promise<LoyaltyBulkOperationRow> {
    const op = await this.handle.db
      .selectFrom('loyalty_bulk_operations')
      .selectAll()
      .where('id', '=', opId)
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!op) {
      throw new NotFoundException({
        message: 'bulk operation not found',
        error_code: 'BULK_OPERATION_NOT_FOUND',
      });
    }
    return op;
  }

  private toSummary(op: LoyaltyBulkOperationRow): BulkOperationSummary {
    return {
      id: op.id,
      type: op.type,
      status: op.status,
      fileName: op.fileName,
      totalRows: op.totalRows,
      validRows: op.validRows,
      invalidRows: op.invalidRows,
      processedRows: op.processedRows,
      successCount: op.successCount,
      failureCount: op.failureCount,
      createdAt: op.createdAt,
    };
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
