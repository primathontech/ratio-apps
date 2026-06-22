import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export function dlqKey(merchantId: string, ts: number, suffix: string): string {
  const date = new Date(ts).toISOString().slice(0, 10);
  return `meta-capi/${date}/${merchantId}/${ts}-${suffix}.json`;
}

@Injectable()
export class CapiDlq {
  private readonly logger = new Logger(CapiDlq.name);
  private readonly s3: S3Client;
  private readonly bucket = process.env.META_CAPI_DLQ_BUCKET ?? 'meta-capi-dlq';

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    this.s3 = new S3Client({
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

  async put(merchantId: string, payload: unknown): Promise<void> {
    const ts = Date.now();
    const key = dlqKey(merchantId, ts, ts.toString(36));
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(payload),
          ContentType: 'application/json',
        }),
      );
    } catch (err) {
      this.logger.error({ msg: 'DLQ put failed', merchantId, key, err: `${err}` });
      throw err;
    }
  }
}
