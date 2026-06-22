import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env.schema';

const BASE = {
  RATIO_API_BASE_URL: 'https://example.com',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ENABLED_MODULES: 'meta',
  RATIO_META_DATABASE_URL: 'mysql://app:app@localhost:3306/meta_app',
  RATIO_META_DATA_ENCRYPTION_KEY: 'YRJeRVlwAwmVLHv3X6YjgBSgbqiY9N+SNBOCQC6ZO5I=',
  RATIO_META_CLIENT_ID: 'x',
  RATIO_META_CLIENT_SECRET: 'y',
  RATIO_META_CALLBACK_URL: 'https://example.com/meta/api/v1/oauth/callback',
  RATIO_META_ADMIN_BASE_URL: 'https://example.com/meta',
};

describe('stream env', () => {
  it('defaults the bus to sqs and consumer disabled', () => {
    const env = loadEnv({ ...BASE });
    expect(env.META_CAPI_BUS).toBe('sqs');
    expect(env.META_CAPI_CONSUMER_ENABLED).toBe('false');
    expect(env.KINESIS_STREAM_NAME).toBe('meta-capi');
    expect(env.META_CAPI_AGG_MAX).toBe(100);
  });
  it('accepts a kinesis bus + custom stream', () => {
    const env = loadEnv({ ...BASE, META_CAPI_BUS: 'kinesis', KINESIS_STREAM_NAME: 'meta-capi-staging' });
    expect(env.META_CAPI_BUS).toBe('kinesis');
    expect(env.KINESIS_STREAM_NAME).toBe('meta-capi-staging');
  });
  it('rejects an invalid bus value', () => {
    expect(() => loadEnv({ ...BASE, META_CAPI_BUS: 'kafka' })).toThrow();
  });
});
