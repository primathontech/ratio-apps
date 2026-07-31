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

/** Forms file-upload S3 policy wrapper over core {@link S3Service} (TRD §2/§6): bucket gate → 503, `<merchantId>/<formId>/<draftId>/<fieldKey>` key layout, forced `attachment` disposition (P2-3 XSS guard). */
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

  /** Signed GET (7-day default; 1-hour for CSV export, passed by ExportJobService). */
  async signedGetUrl(
    objectKey: string,
    expiresInSeconds: number = FORMS_SIGNED_GET_EXPIRY_SECONDS,
  ): Promise<string> {
    // Content-type is client-declared, never byte-verified (P2-3) — force download, never inline render.
    return this.s3.presignGetUrl(this.bucket(), objectKey, expiresInSeconds, 'attachment');
  }

  /** Object exists? (P2-2 submit-time re-check.) A miss returns false; a real S3 error throws. */
  async exists(objectKey: string): Promise<boolean> {
    return this.s3.headExists(this.bucket(), objectKey);
  }

  /** Head bytes of an uploaded object for submit-time magic-byte sniffing (P2-3): the presigned PUT trusts the client-declared content-type, so the real type is only knowable by reading the stored bytes here. */
  async readHeadBytes(objectKey: string, length: number): Promise<Uint8Array> {
    return this.s3.getObjectRange(this.bucket(), objectKey, length);
  }

  /** Stream a CSV body straight into S3 at `objectKey` (export worker). */
  async uploadCsv(objectKey: string, body: Readable): Promise<void> {
    await this.s3.uploadStream(this.bucket(), objectKey, body, 'text/csv; charset=utf-8');
  }
}
