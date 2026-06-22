import {
  CreateBucketCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { CapiDlq } from '../../src/modules/meta/capi/dlq';

const S3_ENDPOINT = process.env.S3_ENDPOINT;
const BUCKET = 'meta-capi-dlq-test';

describe.skipIf(!S3_ENDPOINT)('CapiDlq integration (LocalStack)', () => {
  let s3: S3Client;
  let dlq: CapiDlq;

  beforeAll(async () => {
    s3 = new S3Client({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      endpoint: S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'x',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'x',
      },
    });

    // Create test bucket (ignore if already exists)
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (err: unknown) {
      const code = (err as { Code?: string; name?: string }).Code ?? (err as { name?: string }).name;
      if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') {
        throw err;
      }
    }

    process.env.META_CAPI_DLQ_BUCKET = BUCKET;
    dlq = new CapiDlq();
  });

  it('put → get round-trips JSON payload', async () => {
    const merchant = 'test-merchant';
    const payload = { event: 'Purchase', value: 42.5 };

    await dlq.put(merchant, payload);

    // List objects to find the key we just wrote
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `meta-capi/` }),
    );

    expect(list.Contents).toBeDefined();
    expect(list.Contents!.length).toBeGreaterThan(0);

    const key = list.Contents![list.Contents!.length - 1].Key!;
    expect(key).toMatch(/^meta-capi\/\d{4}-\d{2}-\d{2}\/test-merchant\/.+\.json$/);

    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await obj.Body!.transformToString();
    expect(JSON.parse(body)).toEqual(payload);
  });
});
