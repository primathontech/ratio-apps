import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Optional } from '@nestjs/common';

/** Presigned PUT window — long enough for a slow mobile upload, no longer. */
export const FORMS_UPLOAD_PUT_EXPIRY_SECONDS = 15 * 60;

/** Signed GET expiry — 7 days (TRD §5: webhook payload file links). */
export const FORMS_SIGNED_GET_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/** Signed GET expiry for a finished CSV export download — 1 hour. */
export const FORMS_EXPORT_GET_EXPIRY_SECONDS = 60 * 60;

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
    /** Forced `Content-Disposition` on the signed response (P2-3 XSS guard). */
    responseContentDisposition?: string;
  }): Promise<string>;
}

/** DI token for the presigner override (tests inject a recorder fake). */
export const FORMS_S3_PRESIGNER = Symbol.for('ratio-app:forms:s3-presigner');

/**
 * The streaming-upload seam (mirrors {@link S3PresignerLike}). Prod uses the
 * `@aws-sdk/lib-storage` `Upload` implementation below — it multipart-uploads a
 * `Readable` without ever buffering the whole body, which is what lets the
 * export worker stream a full-history CSV straight from the DB into S3. Tests
 * inject a fake via {@link FORMS_S3_UPLOADER} that records the streamed bytes.
 */
export interface S3UploaderLike {
  upload(params: {
    bucket: string;
    region: string;
    key: string;
    body: Readable;
    contentType: string;
  }): Promise<void>;
}

/** DI token for the uploader override (tests inject a recorder fake). */
export const FORMS_S3_UPLOADER = Symbol.for('ratio-app:forms:s3-uploader');

/**
 * Object-existence seam (P2-2). A submitted object key is fully guessable
 * (`<merchantId>/<formId>/<draftId>/<fieldKey>` — merchantId/formId/fieldKey are
 * public and the draft segment is the only unknown), so a well-formed key that
 * passes structural validation may still point at nothing. This re-checks the
 * object was actually uploaded before a submission stores a reference to it.
 * Prod uses the `HeadObjectCommand` implementation below; tests inject a fake.
 */
export interface S3ObjectCheckerLike {
  exists(params: { bucket: string; region: string; key: string }): Promise<boolean>;
}

/** DI token for the object-checker override (tests inject a fake). */
export const FORMS_S3_OBJECT_CHECKER = Symbol.for('ratio-app:forms:s3-object-checker');

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
    responseContentDisposition?: string;
  }): Promise<string> {
    return getSignedUrl(
      this.client(params.region),
      new GetObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        // Force the response Content-Disposition so a file whose bytes were
        // falsified past the declared type (P2-3) can never be interpreted as
        // an active document (HTML/JS) when an admin opens the signed link — it
        // downloads instead of rendering. Subresource <img> previews are
        // unaffected (disposition is ignored for image loads).
        ResponseContentDisposition: params.responseContentDisposition,
      }),
      { expiresIn: params.expiresInSeconds },
    );
  }
}

/**
 * AWS-SDK-backed streaming uploader. `@aws-sdk/lib-storage`'s `Upload`
 * consumes the `Readable` in multipart chunks — memory stays bounded no matter
 * how large the export is. Credentials resolve through the SDK's default chain
 * (same as the presigner).
 */
class AwsSdkUploader implements S3UploaderLike {
  private readonly clients = new Map<string, S3Client>();

  private client(region: string): S3Client {
    let client = this.clients.get(region);
    if (!client) {
      client = new S3Client({ region });
      this.clients.set(region, client);
    }
    return client;
  }

  async upload(params: {
    bucket: string;
    region: string;
    key: string;
    body: Readable;
    contentType: string;
  }): Promise<void> {
    await new Upload({
      client: this.client(params.region),
      params: {
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      },
    }).done();
  }
}

/**
 * AWS-SDK-backed object checker. A single `HeadObject` per key: 2xx → exists,
 * 404/NotFound → absent. Any other failure (creds/network) is surfaced rather
 * than silently treated as absent, so a transient S3 outage does not reject
 * otherwise-valid submissions as "file not found".
 */
class AwsSdkObjectChecker implements S3ObjectCheckerLike {
  private readonly clients = new Map<string, S3Client>();

  private client(region: string): S3Client {
    let client = this.clients.get(region);
    if (!client) {
      client = new S3Client({ region });
      this.clients.set(region, client);
    }
    return client;
  }

  async exists(params: { bucket: string; region: string; key: string }): Promise<boolean> {
    try {
      await this.client(params.region).send(
        new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }),
      );
      return true;
    } catch (err) {
      const meta = (err as { name?: string; $metadata?: { httpStatusCode?: number } }) ?? {};
      if (meta.name === 'NotFound' || meta.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
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
  private readonly uploader: S3UploaderLike;
  private readonly objectChecker: S3ObjectCheckerLike;

  constructor(
    @Optional() @Inject(FORMS_S3_PRESIGNER) presigner?: S3PresignerLike,
    @Optional() @Inject(FORMS_S3_UPLOADER) uploader?: S3UploaderLike,
    @Optional() @Inject(FORMS_S3_OBJECT_CHECKER) objectChecker?: S3ObjectCheckerLike,
  ) {
    this.presigner = presigner ?? new AwsSdkPresigner();
    this.uploader = uploader ?? new AwsSdkUploader();
    this.objectChecker = objectChecker ?? new AwsSdkObjectChecker();
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

  /**
   * Signed GET — used by the admin detail view and webhook payloads (7-day
   * default) and by the finished CSV export download (1-hour, passed
   * explicitly by ExportJobService).
   */
  async signedGetUrl(
    objectKey: string,
    expiresInSeconds: number = FORMS_SIGNED_GET_EXPIRY_SECONDS,
  ): Promise<string> {
    return this.presigner.presignGet({
      bucket: this.bucket(),
      region: this.region(),
      key: objectKey,
      expiresInSeconds,
      // Uploaded content-type is client-declared and never byte-verified
      // (P2-3), so force download rather than inline rendering on every serve.
      responseContentDisposition: 'attachment',
    });
  }

  /**
   * Whether an object actually exists at `objectKey` (P2-2 submit-time
   * re-check). One `HeadObject` per call; throws only on a real S3 error, not
   * on a plain miss (which returns false).
   */
  async exists(objectKey: string): Promise<boolean> {
    return this.objectChecker.exists({
      bucket: this.bucket(),
      region: this.region(),
      key: objectKey,
    });
  }

  /** Stream a CSV body straight into S3 at `objectKey` (export worker). */
  async uploadCsv(objectKey: string, body: Readable): Promise<void> {
    await this.uploader.upload({
      bucket: this.bucket(),
      region: this.region(),
      key: objectKey,
      body,
      contentType: 'text/csv; charset=utf-8',
    });
  }
}
