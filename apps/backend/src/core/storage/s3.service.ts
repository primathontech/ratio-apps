import type { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, Optional } from '@nestjs/common';

/**
 * Thin, vendor-agnostic S3 wrapper — object storage for generated artifacts
 * (e.g. export CSVs) and direct browser uploads (presigned PUT). Mirrors
 * `core/queue/queue.service.ts`'s env model: the same code talks to real
 * Amazon S3 (prod, pod IAM role) or a local S3-compatible store (MinIO) — only
 * env differs:
 *
 *   LOCAL  S3_ENDPOINT=http://localhost:9000  AWS_REGION=local
 *          AWS_ACCESS_KEY_ID=x  AWS_SECRET_ACCESS_KEY=x
 *   PROD   (no S3_ENDPOINT) → SDK hits real S3 with the pod's IAM role.
 *
 * Buckets are owned by IaC; this service never creates them. Callers pass the
 * bucket per call (per-module env like `LOYALTY_EXPORT_S3_BUCKET` /
 * `FORMS_S3_BUCKET`).
 *
 * The client is fixed at construction. Callers that need a non-`AWS_REGION`
 * region (e.g. forms pins `FORMS_S3_REGION` while `AWS_REGION` points at a
 * local SQS emulator) inject a pre-built {@link S3Client} — the same optional-
 * client seam `EmailService` uses for `EMAIL_REGION`.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;

  constructor(@Optional() client?: S3Client) {
    if (client) {
      this.client = client;
      return;
    }
    const endpoint = process.env.S3_ENDPOINT;
    this.client = new S3Client({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(endpoint
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'x',
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'x',
            },
          }
        : {}),
    });
  }

  /** Upload an object. Callers pre-compress; `contentEncoding` labels it. */
  async putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
    contentEncoding?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
      }),
    );
    this.logger.log({ msg: 's3 object stored', bucket, key });
  }

  /**
   * Presigned GET URL. Expiry is the caller's contract (download vs email).
   * `responseContentDisposition`, when given, forces the served response's
   * `Content-Disposition` (e.g. `attachment` — the forms P2-3 XSS guard so an
   * untrusted upload downloads rather than renders). Omitted → not signed, so
   * the object serves with its stored disposition (loyalty's behaviour).
   */
  presignGetUrl(
    bucket: string,
    key: string,
    expiresSeconds: number,
    responseContentDisposition?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(responseContentDisposition
          ? { ResponseContentDisposition: responseContentDisposition }
          : {}),
      }),
      { expiresIn: expiresSeconds },
    );
  }

  /**
   * Presigned PUT URL for a direct browser upload. SIGNS `Content-Type` and
   * `Content-Length`: S3 rejects an upload whose actual headers differ from the
   * signed values, which is how a size/type constraint is enforced at the
   * storage layer (the presigned-PUT equivalent of a POST policy's
   * `content-length-range` condition — PUT presigns cannot carry POST policy
   * conditions).
   */
  presignPutUrl(
    bucket: string,
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: opts.contentType,
        ContentLength: opts.contentLength,
      }),
      {
        expiresIn: opts.expiresIn,
        // Sign the type/size headers so S3 enforces them on upload.
        signableHeaders: new Set(['host', 'content-type', 'content-length']),
      },
    );
  }

  /**
   * Whether an object exists: a single `HeadObject`. 2xx → true, 404/NotFound
   * → false. Any other failure (creds/network) is rethrown rather than silently
   * treated as absent, so a transient S3 outage is not mistaken for a miss.
   */
  async headExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err) {
      const meta = (err as { name?: string; $metadata?: { httpStatusCode?: number } }) ?? {};
      if (meta.name === 'NotFound' || meta.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  /**
   * Stream a `Readable` straight into S3 via `@aws-sdk/lib-storage`'s multipart
   * `Upload` — memory stays bounded no matter how large the body is (unlike the
   * buffering {@link putObject}). Used by the forms CSV export worker.
   */
  async uploadStream(
    bucket: string,
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<void> {
    await new Upload({
      client: this.client,
      params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
    }).done();
  }
}
