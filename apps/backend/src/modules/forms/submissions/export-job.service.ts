import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import type { FormExportJobRow, FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FORMS_EXPORT_GET_EXPIRY_SECONDS, FormsS3Service } from '../uploads/s3.service';
import { type ExportJobMessage, formsExportQueueName } from './export-job.queue';
import { SubmissionsService } from './submissions.service';

/** The polling view the admin GET returns. */
export interface ExportJobStatusView {
  status: FormExportJobRow['status'];
  rowCount?: number;
  /** 1-hour signed S3 GET — present only once the job is `ready`. */
  downloadUrl?: string;
}

/**
 * Async CSV export orchestration (background job → S3 → signed download URL).
 *
 * `createJob` is the merchant-guarded entry point: it reuses
 * {@link SubmissionsService.requireOwnForm} for ownership (soft-deleted forms
 * included — submissions outlive the form), refuses with 503
 * `exports_unavailable` when S3 or the queue is not configured (the admin then
 * falls back to the synchronous streaming export), otherwise inserts a
 * `pending` row and enqueues its id. The worker does the streaming; this
 * service only reads status back and mints the signed download URL.
 *
 * PII: nothing here logs submission content — ids and status only.
 */
@Injectable()
export class ExportJobService {
  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly submissions: SubmissionsService,
    private readonly queue: QueueService,
    private readonly s3: FormsS3Service,
  ) {}

  /** Async export is available only when BOTH a bucket and a queue exist. */
  private get available(): boolean {
    return Boolean(
      process.env.FORMS_S3_BUCKET?.trim() && process.env.FORMS_EXPORT_QUEUE_URL?.trim(),
    );
  }

  /**
   * Ownership check → 503 if unconfigured → insert `pending` row → enqueue.
   * Returns the freshly-created row (MySQL has no RETURNING, so it is composed
   * in memory from the inserted values).
   */
  async createJob(merchantId: string, formId: string): Promise<FormExportJobRow> {
    // 404 for a form this merchant does not own (checked before the 503 so a
    // caller can't probe queue/bucket configuration for forms they don't own).
    await this.submissions.requireOwnForm(merchantId, formId);

    if (!this.available) {
      throw new ServiceUnavailableException({
        message: 'async export is not available',
        error_code: 'exports_unavailable',
      });
    }

    const id = ExportJobService.mintJobId();
    await this.handle.db
      .insertInto('form_export_jobs')
      .values({ id, formId, merchantId, status: 'pending' })
      .execute();

    await this.queue.sendBatch(formsExportQueueName(), [{ jobId: id } satisfies ExportJobMessage]);

    const now = new Date();
    return {
      id,
      formId,
      merchantId,
      status: 'pending',
      s3Key: null,
      rowCount: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Poll a job. Cross-merchant (or missing) → 404 — the (id, merchantId,
   * formId) filter makes another merchant's job indistinguishable from a
   * nonexistent one. A `ready` job carries a 1-hour signed download URL.
   */
  async getJob(merchantId: string, formId: string, jobId: string): Promise<ExportJobStatusView> {
    const job = await this.handle.db
      .selectFrom('form_export_jobs')
      .selectAll()
      .where('id', '=', jobId)
      .where('merchantId', '=', merchantId)
      .where('formId', '=', formId)
      .limit(1)
      .executeTakeFirst();
    if (!job) {
      throw new NotFoundException({
        message: 'export job not found',
        error_code: 'EXPORT_JOB_NOT_FOUND',
      });
    }

    const view: ExportJobStatusView = { status: job.status };
    if (job.rowCount !== null) view.rowCount = job.rowCount;
    if (job.status === 'ready' && job.s3Key) {
      view.downloadUrl = await this.s3.signedGetUrl(job.s3Key, FORMS_EXPORT_GET_EXPIRY_SECONDS);
    }
    return view;
  }

  /** `exp_<random>` via node:crypto. */
  private static mintJobId(): string {
    return `exp_${randomBytes(12).toString('base64url')}`;
  }
}

/** The S3 object key a finished export is stored under. */
export function exportObjectKey(merchantId: string, formId: string, jobId: string): string {
  return `${merchantId}/${formId}/exports/${jobId}.csv`;
}
