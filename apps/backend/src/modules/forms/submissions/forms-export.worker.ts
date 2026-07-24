import { PassThrough } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import type { FormExportJobRow, FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FormsS3Service } from '../uploads/s3.service';
import { CsvExportService } from './csv-export.service';
import { type ExportJobMessage, formsExportQueueName } from './export-job.queue';
import { exportObjectKey } from './export-job.service';

/**
 * Drains the forms CSV-export SQS queue (webhook-delivery worker precedent):
 * self-gated by `FORMS_EXPORT_WORKER_ENABLED`, long-polls via the core
 * `QueueService`, and for each `{ jobId }` streams the full-history CSV from
 * {@link CsvExportService} straight into S3 (a `PassThrough` bridges the
 * synchronous sink writes to `@aws-sdk/lib-storage`'s multipart `Upload`, so
 * memory stays bounded).
 *
 * State machine on the row: `pending → processing → ready | failed`. A message
 * is acked once the attempt SETTLES (outcome lives in the row): a redelivered
 * or double-fired message whose row is no longer `pending` is a no-op. Only an
 * UNEXPECTED error (e.g. the DB is unreachable while marking the outcome)
 * leaves the message un-acked to redeliver.
 *
 * PII: submission values never appear in a log line — ids, counts, and status
 * only. The stored failure `error` is a short, PII-free message.
 */
@Injectable()
export class FormsExportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FormsExportWorker.name);
  private running = false;

  /** Above a large export's processing time so an in-flight job doesn't redeliver. */
  private readonly VISIBILITY = Number(process.env.FORMS_EXPORT_VISIBILITY ?? 300);

  constructor(
    private readonly queue: QueueService,
    private readonly csv: CsvExportService,
    private readonly s3: FormsS3Service,
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
  ) {}

  onModuleInit(): void {
    if (process.env.FORMS_EXPORT_WORKER_ENABLED !== 'true') {
      this.logger.log('forms export worker disabled (FORMS_EXPORT_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'forms export worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  onModuleDestroy(): void {
    // Stop the loop; the in-flight drainOnce() finishes, then loop() exits.
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'forms export worker loop error', err: `${err}` });
        await this.sleep(1000);
      }
    }
  }

  /** Receive one batch (≤10) and process each job. Exposed for deterministic tests. */
  async drainOnce(): Promise<void> {
    const queueName = formsExportQueueName();
    const msgs = await this.queue.receive<ExportJobMessage>(queueName, 10, 5, this.VISIBILITY);
    for (const m of msgs) {
      try {
        await this.process(m.body);
        await this.queue.ack(queueName, [m.receiptHandle]);
      } catch (err) {
        // Not acked → redelivers after VISIBILITY. Never log the payload.
        this.logger.error({
          msg: 'forms export message failed (will retry)',
          jobId: m.body?.jobId,
          err: `${err}`,
        });
      }
    }
  }

  private async process(msg: ExportJobMessage): Promise<void> {
    const job = await this.handle.db
      .selectFrom('form_export_jobs')
      .selectAll()
      .where('id', '=', msg.jobId)
      .limit(1)
      .executeTakeFirst();
    if (!job) {
      this.logger.warn({ msg: 'export job row vanished — dropping', jobId: msg.jobId });
      return;
    }
    if (job.status !== 'pending') {
      // Already settled (redelivery / double-fire) — idempotent no-op.
      return;
    }

    await this.mark(job.id, { status: 'processing' });
    try {
      const { key, rowCount } = await this.runExport(job);
      await this.mark(job.id, { status: 'ready', s3Key: key, rowCount });
      this.logger.log({ msg: 'forms export ready', jobId: job.id, rowCount });
    } catch (err) {
      // Terminal failure — record it and let the message ack (no redelivery).
      await this.mark(job.id, { status: 'failed', error: FormsExportWorker.shortError(err) });
      this.logger.error({ msg: 'forms export failed', jobId: job.id, err: `${err}` });
    }
  }

  /** Stream the CSV into S3, returning the object key and data-row count. */
  private async runExport(job: FormExportJobRow): Promise<{ key: string; rowCount: number }> {
    const key = exportObjectKey(job.merchantId, job.formId, job.id);
    const pass = new PassThrough();
    const uploadPromise = this.s3.uploadCsv(key, pass);
    try {
      const rowCount = await this.csv.export(job.merchantId, job.formId, {
        write: (chunk) => {
          if (!pass.write(chunk)) {
            // Respect backpressure so a huge export can't outrun the upload.
            return new Promise<void>((resolve) => pass.once('drain', resolve));
          }
        },
      });
      pass.end();
      await uploadPromise;
      return { key, rowCount };
    } catch (err) {
      pass.destroy(err as Error);
      await uploadPromise.catch(() => undefined);
      throw err;
    }
  }

  private async mark(
    id: string,
    set: Partial<Pick<FormExportJobRow, 'status' | 's3Key' | 'rowCount' | 'error'>>,
  ): Promise<void> {
    await this.handle.db
      .updateTable('form_export_jobs')
      .set({ ...set, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('id', '=', id)
      .execute();
  }

  /** A short, PII-free failure string that fits the `error` column (≤512). */
  private static shortError(err: unknown): string {
    return `${(err as Error)?.message ?? err}`.slice(0, 512);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
