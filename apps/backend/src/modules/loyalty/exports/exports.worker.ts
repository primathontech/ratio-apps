import { gzipSync } from 'node:zlib';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { LOYALTY_EXPORT_MAX_ROWS } from '@ratio-app/shared/schemas/loyalty-export';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { EmailService } from '../../../core/email/email.service';
import { QueueService } from '../../../core/queue/queue.service';
import { S3Service } from '../../../core/storage/s3.service';
import { LOYALTY_QUEUE_NAMES, type LoyaltyExportMessage } from '../bulk/loyalty-queues';
import type { LoyaltyCustomerRow, LoyaltyDatabase } from '../db/types';
import { LOYALTY_DB_TOKEN } from '../kysely.module';
import type { CustomerQuery } from '../mirror/customer-query.types';
import { LOYALTY_CUSTOMER_QUERY, parseFilters } from './exports.service';

const CSV_HEADER =
  'customer_id,phone_number,email,name,coins_balance,lifetime_earned,' +
  'lifetime_redeemed,lifetime_spend,lifetime_orders,last_order_date';

/** Presign expiry for the emailed link (7 days, TRD §2c). */
const EMAIL_LINK_EXPIRES_S = 7 * 24 * 3600;

/**
 * Drains `loyalty-exports`: streams the customer mirror through the
 * {@link CustomerQuery} contract → CSV → gzip → S3, then (optionally) emails a
 * 7-day presigned link (TRD §2c). Wizzy worker pattern — runs only when
 * `LOYALTY_WORKER_ENABLED=true`; ack on success, thrown error → no ack.
 *
 * Failure taxonomy:
 *   - missing/`done` export → skip + ack (stale or duplicate message);
 *   - `LOYALTY_EXPORT_S3_BUCKET` unset → permanent config error: mark the
 *     export `failed`, ACK (redelivery can't fix an env gap), log loudly;
 *   - S3 upload failure → mark `failed` but THROW (no ack) so the redelivered
 *     message retries — `failed` is a processable status;
 *   - email failure → log only; the export itself is already `done`.
 */
@Injectable()
export class ExportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportsWorker.name);
  private running = false;

  private readonly VISIBILITY = Number(process.env.LOYALTY_EXPORT_VISIBILITY ?? 300);

  constructor(
    @Inject(LOYALTY_DB_TOKEN) private readonly handle: KyselyClient<LoyaltyDatabase>,
    private readonly queue: QueueService,
    private readonly s3: S3Service,
    private readonly email: EmailService,
    @Inject(LOYALTY_CUSTOMER_QUERY) private readonly query: CustomerQuery,
  ) {}

  onModuleDestroy(): void {
    this.running = false;
  }

  onModuleInit(): void {
    if (process.env.LOYALTY_WORKER_ENABLED !== 'true') {
      this.logger.log('Loyalty exports worker disabled (LOYALTY_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'Loyalty exports worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'Loyalty exports worker loop error', err });
        await sleep(1000);
      }
    }
  }

  async drainOnce(): Promise<void> {
    const msgs = await this.queue.receive<LoyaltyExportMessage>(
      LOYALTY_QUEUE_NAMES.exports,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.process(m.body);
        await this.queue.ack(LOYALTY_QUEUE_NAMES.exports, [m.receiptHandle]);
      } catch (err) {
        this.logger.error({ msg: 'Loyalty export message failed (will retry)', err });
      }
    }
  }

  private async process(msg: LoyaltyExportMessage): Promise<void> {
    const row = await this.handle.db
      .selectFrom('loyalty_exports')
      .selectAll()
      .where('id', '=', msg.exportId)
      .where('merchantId', '=', msg.merchantId)
      .executeTakeFirst();
    if (!row || row.status === 'done') {
      this.logger.warn({
        msg: 'Loyalty export message skipped (missing or already done)',
        exportId: msg.exportId,
        status: row?.status ?? 'missing',
      });
      return;
    }

    const bucket = process.env.LOYALTY_EXPORT_S3_BUCKET;
    if (!bucket) {
      this.logger.error({
        msg: 'LOYALTY_EXPORT_S3_BUCKET is not set — export permanently failed',
        exportId: msg.exportId,
      });
      await this.setStatus(msg.exportId, 'failed');
      return; // permanent config error — ack, redelivery cannot fix it
    }

    await this.setStatus(msg.exportId, 'processing');

    const lines = [CSV_HEADER];
    let rowCount = 0;
    for await (const customer of this.query.streamAll(
      msg.merchantId,
      parseFilters(row.filters),
      LOYALTY_EXPORT_MAX_ROWS,
    )) {
      lines.push(toCsvLine(customer));
      rowCount += 1;
    }
    const body = gzipSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
    const s3Key = `loyalty/exports/${msg.merchantId}/${msg.exportId}.csv.gz`;

    try {
      await this.s3.putObject(bucket, s3Key, body, 'text/csv', 'gzip');
    } catch (err) {
      await this.setStatus(msg.exportId, 'failed');
      throw err; // no ack — redelivery retries the upload
    }

    await this.handle.db
      .updateTable('loyalty_exports')
      .set({
        status: 'done',
        rowCount,
        s3Key,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where('id', '=', msg.exportId)
      .execute();

    if (row.email) await this.sendLink(msg, row.email, bucket, s3Key, rowCount);
  }

  /** Best-effort: an email failure never fails a finished export. */
  private async sendLink(
    msg: LoyaltyExportMessage,
    to: string,
    bucket: string,
    s3Key: string,
    rowCount: number,
  ): Promise<void> {
    try {
      const url = await this.s3.presignGetUrl(bucket, s3Key, EMAIL_LINK_EXPIRES_S);
      await this.email.send(
        to,
        `Your loyalty customer export is ready (${rowCount} rows)`,
        `<p>Your loyalty customer export (${rowCount} rows) is ready.</p>` +
          `<p><a href="${url}">Download the CSV (gzip)</a> — the link expires in 7 days.</p>`,
      );
      await this.handle.db
        .updateTable('loyalty_exports')
        .set({ emailedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', msg.exportId)
        .execute();
    } catch (err) {
      this.logger.error({ msg: 'Loyalty export email failed (export stays done)', err });
    }
  }

  private async setStatus(exportId: string, status: 'processing' | 'failed'): Promise<void> {
    await this.handle.db
      .updateTable('loyalty_exports')
      .set({ status, updatedAt: new Date() })
      .where('id', '=', exportId)
      .execute();
  }
}

function toCsvLine(c: LoyaltyCustomerRow): string {
  return [
    c.phone, // customer_id IS the phone (mirror PK)
    c.phone,
    c.email ?? '',
    c.name ?? '',
    c.pointsBalance,
    c.lifetimeEarned,
    c.lifetimeRedeemed,
    c.lifetimeSpend,
    c.lifetimeOrders,
    c.lastOrderAt ? c.lastOrderAt.toISOString().slice(0, 10) : '',
  ]
    .map((v) => csvEscape(String(v)))
    .join(',');
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
