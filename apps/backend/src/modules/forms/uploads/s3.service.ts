import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { S3Service } from '../../../core/storage/s3.service';

/** Presigned PUT window — long enough for a slow mobile upload, no longer. */
export const FORMS_UPLOAD_PUT_EXPIRY_SECONDS = 15 * 60;

/** Signed GET expiry — 7 days (TRD §5: webhook payload file links). */
export const FORMS_SIGNED_GET_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/** Signed GET expiry for a finished CSV export download — 1 hour. */
export const FORMS_EXPORT_GET_EXPIRY_SECONDS = 60 * 60;

/**
 * S3 presigning for form file uploads (TRD §2/§6).
 *
 * A thin forms POLICY wrapper over the shared {@link S3Service} (core/storage) —
 * mirroring how forms email delivery wraps `core/email`. The transport (SDK
 * clients, presigning, multipart streaming, HEAD) lives in core; everything
 * forms-specific stays here:
 *   - the `enabled` bucket gate (blank `FORMS_S3_BUCKET` → uploads disabled,
 *     endpoint answers 503),
 *   - the per-call bucket (`FORMS_S3_BUCKET` — passed on every core call),
 *   - the strict object-key layout `<merchantId>/<formId>/<draftId>/<fieldKey>`
 *     (submit-time validation rejects any key outside the form's prefix),
 *   - the forced `attachment` disposition on signed GETs (P2-3 XSS guard),
 *   - the three expiry contracts above.
 *
 * The forms region override (`FORMS_S3_REGION`, NOT bare `AWS_REGION`) is baked
 * into the injected {@link S3Service}'s client by the forms module provider —
 * see `forms.module.ts`.
 *
 * Env (module-validated, read at call time — never in env.schema.ts):
 * `FORMS_S3_BUCKET` (blank → uploads disabled, endpoint answers 503).
 */
@Injectable()
export class FormsS3Service {
  constructor(private readonly s3: S3Service) {}

  /** Uploads are enabled only when a bucket is configured. */
  get enabled(): boolean {
    return Boolean(process.env.FORMS_S3_BUCKET?.trim());
  }

  private bucket(): string {
    return process.env.FORMS_S3_BUCKET?.trim() ?? '';
  }

  /** Mint the draft-scoped object key + presigned PUT for one file field. */
  async createUpload(params: {
    merchantId: string;
    formId: string;
    fieldKey: string;
    contentType: string;
    size: number;
  }): Promise<{ uploadUrl: string; objectKey: string }> {
    const draftId = `draft_${randomBytes(9).toString('base64url')}`;
    const objectKey = `${params.merchantId}/${params.formId}/${draftId}/${params.fieldKey}`;
    const uploadUrl = await this.s3.presignPutUrl(this.bucket(), objectKey, {
      contentType: params.contentType,
      contentLength: params.size,
      expiresIn: FORMS_UPLOAD_PUT_EXPIRY_SECONDS,
    });
    return { uploadUrl, objectKey };
  }

  /**
   * Signed GET — used by the admin detail view and webhook payloads (7-day
   * default) and by the finished CSV export download (1-hour, passed
   * explicitly by ExportJobService).
   */
  async signedGetUrl(
    objectKey: string,
    expiresInSeconds: number = FORMS_SIGNED_GET_EXPIRY_SECONDS,
  ): Promise<string> {
    // Uploaded content-type is client-declared and never byte-verified (P2-3),
    // so force download rather than inline rendering on every serve.
    return this.s3.presignGetUrl(this.bucket(), objectKey, expiresInSeconds, 'attachment');
  }

  /**
   * Whether an object actually exists at `objectKey` (P2-2 submit-time
   * re-check). One `HeadObject` per call; throws only on a real S3 error, not
   * on a plain miss (which returns false).
   */
  async exists(objectKey: string): Promise<boolean> {
    return this.s3.headExists(this.bucket(), objectKey);
  }

  /** Stream a CSV body straight into S3 at `objectKey` (export worker). */
  async uploadCsv(objectKey: string, body: Readable): Promise<void> {
    await this.s3.uploadStream(this.bucket(), objectKey, body, 'text/csv; charset=utf-8');
  }
}
