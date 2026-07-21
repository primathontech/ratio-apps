import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Thin, vendor-agnostic S3 wrapper — object storage for generated artifacts
 * (e.g. export CSVs). Mirrors `core/queue/queue.service.ts`'s env model: the
 * same code talks to real Amazon S3 (prod, pod IAM role) or a local
 * S3-compatible store (MinIO) — only env differs:
 *
 *   LOCAL  S3_ENDPOINT=http://localhost:9000  AWS_REGION=local
 *          AWS_ACCESS_KEY_ID=x  AWS_SECRET_ACCESS_KEY=x
 *   PROD   (no S3_ENDPOINT) → SDK hits real S3 with the pod's IAM role.
 *
 * Buckets are owned by IaC; this service never creates them. Callers pass the
 * bucket per call (per-module env like `LOYALTY_EXPORT_S3_BUCKET`).
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;

  constructor() {
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

  /** Presigned GET URL. Expiry is the caller's contract (download vs email). */
  presignGetUrl(bucket: string, key: string, expiresSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresSeconds,
    });
  }
}
