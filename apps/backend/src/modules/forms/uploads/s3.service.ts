import { randomBytes } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Optional } from '@nestjs/common';

/** Presigned PUT window — long enough for a slow mobile upload, no longer. */
export const FORMS_UPLOAD_PUT_EXPIRY_SECONDS = 15 * 60;

/** Signed GET expiry — 7 days (TRD §5: webhook payload file links). */
export const FORMS_SIGNED_GET_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/**
 * The thin presigner seam. Prod uses the AWS SDK implementation below
 * (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`); tests inject a
 * recorder fake via {@link FORMS_S3_PRESIGNER} — the rest of the module only
 * sees this interface.
 */
export interface S3PresignerLike {
  presignPut(params: {
    bucket: string;
    region: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<string>;
  presignGet(params: {
    bucket: string;
    region: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

/** DI token for the presigner override (tests inject a recorder fake). */
export const FORMS_S3_PRESIGNER = Symbol.for('ratio-app:forms:s3-presigner');

/**
 * AWS-SDK-backed presigner. Credentials resolve through the SDK's default
 * chain (env keys locally, the pod's IAM role in prod).
 *
 * The presigned PUT SIGNS `Content-Type` and `Content-Length`: S3 rejects an
 * upload whose actual headers differ from the signed values, which is how
 * the ≤5 MB size constraint is enforced at the storage layer (the presigned
 * PUT equivalent of a POST policy's `content-length-range` condition — PUT
 * presigns cannot carry POST policy conditions).
 */
class AwsSdkPresigner implements S3PresignerLike {
  /** One client per region (in practice a single region). */
  private readonly clients = new Map<string, S3Client>();

  private client(region: string): S3Client {
    let client = this.clients.get(region);
    if (!client) {
      client = new S3Client({ region });
      this.clients.set(region, client);
    }
    return client;
  }

  presignPut(params: {
    bucket: string;
    region: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client(params.region),
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        ContentType: params.contentType,
        ContentLength: params.contentLength,
      }),
      {
        expiresIn: params.expiresInSeconds,
        // Sign the type/size headers so S3 enforces them on upload.
        signableHeaders: new Set(['host', 'content-type', 'content-length']),
      },
    );
  }

  presignGet(params: {
    bucket: string;
    region: string;
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client(params.region),
      new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
      { expiresIn: params.expiresInSeconds },
    );
  }
}

/**
 * S3 presigning for form file uploads (TRD §2/§6).
 *
 * Object keys are strictly `<merchantId>/<formId>/<draftId>/<fieldKey>` —
 * submit-time validation rejects any key outside the submitting form's
 * prefix, and objects are never public-read (7-day signed GETs only).
 *
 * Env (module-validated, read at call time — never in env.schema.ts):
 * `FORMS_S3_BUCKET` (blank → uploads disabled, endpoint answers 503) and
 * `FORMS_S3_REGION` (default ap-south-1).
 */
@Injectable()
export class FormsS3Service {
  private readonly presigner: S3PresignerLike;

  constructor(@Optional() @Inject(FORMS_S3_PRESIGNER) presigner?: S3PresignerLike) {
    this.presigner = presigner ?? new AwsSdkPresigner();
  }

  /** Uploads are enabled only when a bucket is configured. */
  get enabled(): boolean {
    return Boolean(process.env.FORMS_S3_BUCKET?.trim());
  }

  private bucket(): string {
    return process.env.FORMS_S3_BUCKET?.trim() ?? '';
  }

  private region(): string {
    return process.env.FORMS_S3_REGION?.trim() || 'ap-south-1';
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
    const uploadUrl = await this.presigner.presignPut({
      bucket: this.bucket(),
      region: this.region(),
      key: objectKey,
      contentType: params.contentType,
      contentLength: params.size,
      expiresInSeconds: FORMS_UPLOAD_PUT_EXPIRY_SECONDS,
    });
    return { uploadUrl, objectKey };
  }

  /** 7-day signed GET — used by the admin detail view and webhook payloads. */
  async signedGetUrl(objectKey: string): Promise<string> {
    return this.presigner.presignGet({
      bucket: this.bucket(),
      region: this.region(),
      key: objectKey,
      expiresInSeconds: FORMS_SIGNED_GET_EXPIRY_SECONDS,
    });
  }
}
