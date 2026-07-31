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

/** Vendor-agnostic S3 wrapper; same code hits real S3 or local MinIO by env only. Buckets are IaC-owned (never created here); an optional injected S3Client is the seam for a non-`AWS_REGION` region. */
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

  /** Presigned GET URL; `responseContentDisposition` forces the served `Content-Disposition` (e.g. `attachment` — the forms P2-3 XSS guard so untrusted uploads download, not render). */
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

  /** Presigned PUT for a direct browser upload; SIGNS `Content-Type`/`Content-Length` so S3 rejects mismatched headers, enforcing size/type at the storage layer. */
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
        signableHeaders: new Set(['host', 'content-type', 'content-length']),
      },
    );
  }

  /** Object existence via HeadObject: 404 → false, but other errors rethrow so a transient outage isn't mistaken for a miss. */
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

  /** First `length` bytes of an object via a ranged GET — the seam for server-side magic-byte sniffing (P2-3), so a spoofed content-type can be caught without pulling the whole (up to 5MB) object. A shorter object yields fewer bytes; a missing object throws like any other GET. */
  async getObjectRange(bucket: string, key: string, length: number): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${length - 1}` }),
    );
    const body = res.Body as Readable | undefined;
    if (!body) return new Uint8Array(0);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  /** Stream into S3 via multipart Upload so memory stays bounded regardless of body size (unlike the buffering putObject). */
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
