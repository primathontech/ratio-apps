import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LOYALTY_EXPORT_EMAIL_THRESHOLD,
  LOYALTY_EXPORT_MAX_ROWS,
  type LoyaltyCustomerFilters,
  loyaltyExportRequestSchema,
} from '@ratio-app/shared/schemas/loyalty-export';
import { ulid } from 'ulid';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import type { S3Service } from '../../../core/storage/s3.service';
import { LOYALTY_QUEUE_NAMES, type LoyaltyExportMessage } from '../bulk/loyalty-queues';
import type { LoyaltyDatabase, LoyaltyExportRow } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import type { CustomerQuery } from '../mirror/customer-query.types';

/**
 * DI token for the {@link CustomerQuery} implementation (the mirror vertical's
 * `customer-query.service.ts`). Lives here — with its first consumer — so the
 * exports vertical never imports mirror *implementation* files, only the
 * `customer-query.types.ts` contract.
 */
export const LOYALTY_CUSTOMER_QUERY = Symbol.for('ratio-app:loyalty:customer-query');

export interface ExportSummary {
  id: string;
  status: string;
  filters: LoyaltyCustomerFilters;
  email: string | null;
  rowCount: number | null;
  emailedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

/**
 * Customer-mirror CSV exports (TRD §2c): create (count-gated) → job row +
 * `loyalty-exports` message → the worker builds the gzip CSV in S3; downloads
 * are always fresh 15-minute presigned URLs (no CSV bytes in MySQL).
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly queue: QueueService,
    @Inject(LOYALTY_CUSTOMER_QUERY) private readonly query: CustomerQuery,
  ) {}

  async create(
    merchantId: string,
    body: unknown,
  ): Promise<ExportSummary & { rowCountEstimate: number }> {
    const parsed = loyaltyExportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'invalid export request',
        error_code: 'INVALID_EXPORT_REQUEST',
      });
    }
    const { filters, email } = parsed.data;

    const count = await this.query.count(merchantId, filters);
    if (count > LOYALTY_EXPORT_MAX_ROWS) {
      throw new UnprocessableEntityException({
        message: `export exceeds the ${LOYALTY_EXPORT_MAX_ROWS}-row cap — narrow the filters`,
        error_code: 'EXPORT_TOO_LARGE',
      });
    }
    if (count > LOYALTY_EXPORT_EMAIL_THRESHOLD && !email) {
      throw new UnprocessableEntityException({
        message: `exports over ${LOYALTY_EXPORT_EMAIL_THRESHOLD} rows require an email`,
        error_code: 'EMAIL_REQUIRED',
      });
    }

    const id = ulid();
    await this.handle.db
      .insertInto('loyalty_exports')
      .values({
        id,
        merchantId,
        filters: JSON.stringify(filters),
        status: 'pending',
        email: email ?? null,
      })
      .execute();

    const message: LoyaltyExportMessage = { exportId: id, merchantId };
    await this.queue.sendBatch(LOYALTY_QUEUE_NAMES.exports, [message]);

    return { ...this.toSummary(await this.getRow(merchantId, id)), rowCountEstimate: count };
  }

  async list(
    merchantId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ExportSummary[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, Math.trunc(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
    const rows = await this.handle.db
      .selectFrom('loyalty_exports')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit)
      .execute();
    const counted = await this.handle.db
      .selectFrom('loyalty_exports')
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

  async get(merchantId: string, id: string): Promise<ExportSummary> {
    return this.toSummary(await this.getRow(merchantId, id));
  }

  /** Fresh 15-minute presigned URL for a finished export (TRD §2c step 5). */
  async downloadUrl(merchantId: string, id: string, s3: S3Service): Promise<string> {
    const row = await this.getRow(merchantId, id);
    const bucket = process.env.LOYALTY_EXPORT_S3_BUCKET;
    if (row.status !== 'done' || !row.s3Key || !bucket) {
      throw new ConflictException({
        message: `export is not ready for download (status '${row.status}')`,
        error_code: 'EXPORT_NOT_READY',
      });
    }
    return s3.presignGetUrl(bucket, row.s3Key, 900);
  }

  private async getRow(merchantId: string, id: string): Promise<LoyaltyExportRow> {
    const row = await this.handle.db
      .selectFrom('loyalty_exports')
      .selectAll()
      .where('id', '=', id)
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'export not found',
        error_code: 'EXPORT_NOT_FOUND',
      });
    }
    return row;
  }

  private toSummary(row: LoyaltyExportRow): ExportSummary {
    return {
      id: row.id,
      status: row.status,
      filters: parseFilters(row.filters),
      email: row.email,
      rowCount: row.rowCount,
      emailedAt: row.emailedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }
}

/** mysql2 returns JSON columns parsed; the fake (and raw drivers) keep strings. */
export function parseFilters(value: unknown): LoyaltyCustomerFilters {
  const raw = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return (Array.isArray(raw) ? raw : []) as LoyaltyCustomerFilters;
}
