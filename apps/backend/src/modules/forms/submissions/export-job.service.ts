import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import { s3Bucket } from '../../../core/storage/s3.service';
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

/** Async CSV export orchestration (background job → S3 → signed URL); refuses with 503 `exports_unavailable` when S3/queue unconfigured. PII: logs ids and status only, never submission content. */
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
    return Boolean(s3Bucket() && process.env.FORMS_EXPORT_QUEUE_URL?.trim());
  }

  /** Ownership → 503-if-unconfigured → insert `pending` → enqueue; returns the row composed in memory (MySQL has no RETURNING). */
  async createJob(merchantId: string, formId: string): Promise<FormExportJobRow> {
    // Ownership checked before the 503 so a caller can't probe queue/bucket config for forms they don't own.
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

  /** Poll a job; the (id, merchantId, formId) filter makes another merchant's job 404, indistinguishable from nonexistent. */
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
