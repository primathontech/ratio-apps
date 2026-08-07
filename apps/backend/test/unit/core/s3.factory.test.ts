import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { S3Service, s3Bucket, s3Region } from '@/core/storage/s3.service';

/**
 * One bucket and one region for every module. The region must come from
 * `S3_REGION`, never `AWS_REGION` — that one is the SQS knob in this repo
 * (`elasticmq` locally, `us-east-1` in `.env.example`), and signing S3 with it
 * fails every call. That mismatch is what broke loyalty exports while forms,
 * which had pinned its own region, kept working.
 */
function regionOf(service: S3Service): Promise<string> {
  // The client is private; read the resolved region off it the way the SDK does.
  const client = (service as unknown as { client: { config: { region: () => Promise<string> } } })
    .client;
  return client.config.region();
}

describe('core S3 configuration', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'AWS_REGION']) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('s3Bucket returns the one shared bucket, or undefined when unset/blank', () => {
    expect(s3Bucket()).toBeUndefined();
    process.env.S3_BUCKET = '   ';
    expect(s3Bucket()).toBeUndefined(); // blank is unset, not a bucket named ' '
    process.env.S3_BUCKET = ' ratio-app-storage ';
    expect(s3Bucket()).toBe('ratio-app-storage');
  });

  it('s3Region ignores AWS_REGION and falls back to ap-south-1', () => {
    process.env.AWS_REGION = 'elasticmq';
    expect(s3Region()).toBe('ap-south-1');
    process.env.S3_REGION = 'ap-south-2';
    expect(s3Region()).toBe('ap-south-2');
  });

  it('builds its client on S3_REGION even when AWS_REGION says otherwise', async () => {
    process.env.AWS_REGION = 'elasticmq';
    process.env.S3_REGION = 'ap-south-1';
    expect(await regionOf(new S3Service())).toBe('ap-south-1');
  });

  it('still honours S3_ENDPOINT so local MinIO works', async () => {
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_REGION = 'ap-south-1';
    const service = new S3Service();
    expect(await regionOf(service)).toBe('ap-south-1');
    const client = (service as unknown as { client: { config: { endpoint?: unknown } } }).client;
    expect(client.config.endpoint).toBeDefined();
  });
});
