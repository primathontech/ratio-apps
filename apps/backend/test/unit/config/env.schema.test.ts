import { describe, expect, it } from 'vitest';
import { envSchema, loadEnv } from '@/config/env.schema';

// Buffer.alloc(32).toString('base64') is `'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='`
// — exactly 44 chars, matches the strict `/^[A-Za-z0-9+/]{43}=$/` shape.
//
// env.schema derives per-app keys from APPS (currently `google`, `meta`, `posthog`, `moengage`).
const validEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  PORT: '3000',
  RATIO_API_BASE_URL: 'https://sandbox-os-ecosystem.dev.gokwik.io',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  // `google` app keys (derived from the APPS tuple — required by the schema).
  RATIO_GOOGLE_DATABASE_URL: 'mysql://app:app@localhost:3306/google_app',
  RATIO_GOOGLE_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_GOOGLE_CLIENT_ID: 'goog_id',
  RATIO_GOOGLE_CLIENT_SECRET: 'goog_secret',
  RATIO_GOOGLE_CALLBACK_URL: 'http://localhost:3000/google/api/v1/oauth/callback',
  RATIO_GOOGLE_ADMIN_BASE_URL: 'http://localhost:5173',
  // `meta` app keys (derived from the APPS tuple — required by the schema).
  RATIO_META_DATABASE_URL: 'mysql://app:app@localhost:3306/meta_app',
  RATIO_META_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_META_CLIENT_ID: 'meta_id',
  RATIO_META_CLIENT_SECRET: 'meta_secret',
  RATIO_META_CALLBACK_URL: 'http://localhost:3000/meta/api/v1/oauth/callback',
  RATIO_META_ADMIN_BASE_URL: 'http://localhost:5173',
  // `posthog` app keys (derived from the APPS tuple — required by the schema).
  RATIO_POSTHOG_DATABASE_URL: 'mysql://app:app@localhost:3306/posthog_app',
  RATIO_POSTHOG_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_POSTHOG_CLIENT_ID: 'posthog_id',
  RATIO_POSTHOG_CLIENT_SECRET: 'posthog_secret',
  RATIO_POSTHOG_CALLBACK_URL: 'http://localhost:3000/posthog/api/v1/oauth/callback',
  RATIO_POSTHOG_ADMIN_BASE_URL: 'http://localhost:5173',
  // `moengage` app keys (derived from the APPS tuple — required by the schema).
  RATIO_MOENGAGE_DATABASE_URL: 'mysql://app:app@localhost:3306/moengage_app',
  RATIO_MOENGAGE_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_MOENGAGE_CLIENT_ID: 'moengage_id',
  RATIO_MOENGAGE_CLIENT_SECRET: 'moengage_secret',
  RATIO_MOENGAGE_CALLBACK_URL: 'http://localhost:3000/moengage/api/v1/oauth/callback',
  RATIO_MOENGAGE_ADMIN_BASE_URL: 'http://localhost:5174',
  // `wizzy` app keys (derived from the APPS tuple — required by the schema).
  RATIO_WIZZY_DATABASE_URL: 'mysql://app:app@localhost:3306/wizzy_app',
  RATIO_WIZZY_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_WIZZY_CLIENT_ID: 'wizzy_id',
  RATIO_WIZZY_CLIENT_SECRET: 'wizzy_secret',
  RATIO_WIZZY_CALLBACK_URL: 'http://localhost:3000/wizzy/api/v1/oauth/callback',
  RATIO_WIZZY_ADMIN_BASE_URL: 'http://localhost:5174',
  // `rp` app keys (derived from the APPS tuple — required by the schema).
  RATIO_RP_DATABASE_URL: 'mysql://app:app@localhost:3306/rp_app',
  RATIO_RP_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_RP_CLIENT_ID: 'rp_id',
  RATIO_RP_CLIENT_SECRET: 'rp_secret',
  RATIO_RP_CALLBACK_URL: 'http://localhost:3000/rp/api/v1/oauth/callback',
  RATIO_RP_ADMIN_BASE_URL: 'http://localhost:5174',
  // `forms` app keys (derived from the APPS tuple — required by the schema).
  RATIO_FORMS_DATABASE_URL: 'mysql://app:app@localhost:3306/forms_app',
  RATIO_FORMS_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  RATIO_FORMS_CLIENT_ID: 'forms_id',
  RATIO_FORMS_CLIENT_SECRET: 'forms_secret',
  RATIO_FORMS_CALLBACK_URL: 'http://localhost:3000/forms/api/v1/oauth/callback',
  RATIO_FORMS_ADMIN_BASE_URL: 'http://localhost:5174',
};

describe('envSchema', () => {
  it('parses a full valid env', () => {
    expect(envSchema.safeParse(validEnv).success).toBe(true);
  });

  it('rejects when a per-app credential is missing', () => {
    const { RATIO_GOOGLE_CLIENT_SECRET: _ignored, ...without } = validEnv;
    expect(envSchema.safeParse(without).success).toBe(false);
  });

  it('rejects an encryption key of wrong length', () => {
    const bad = { ...validEnv, RATIO_GOOGLE_DATA_ENCRYPTION_KEY: 'tooshort' };
    expect(envSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an encryption key with non-base64 chars even if decode-length is 32', () => {
    // The strict regex must reject inputs the permissive base64 parser would
    // silently accept — Node's `Buffer.from(str, 'base64')` ignores
    // whitespace and invalid chars, so a sloppy string can decode to the
    // right length but isn't a real canonical-base64 key.
    const bad = { ...validEnv, RATIO_GOOGLE_DATA_ENCRYPTION_KEY: '!!!nope!!!' };
    expect(envSchema.safeParse(bad).success).toBe(false);
  });

  it('trims whitespace around the encryption key before validating', () => {
    const padded = {
      ...validEnv,
      RATIO_GOOGLE_DATA_ENCRYPTION_KEY: `  ${Buffer.alloc(32).toString('base64')}\n`,
    };
    expect(envSchema.safeParse(padded).success).toBe(true);
  });

  it('defaults DB_POOL_SIZE to 5 and coerces strings', () => {
    const env = loadEnv(validEnv);
    expect(env.DB_POOL_SIZE).toBe(5);
    const env2 = loadEnv({ ...validEnv, DB_POOL_SIZE: '10' });
    expect(env2.DB_POOL_SIZE).toBe(10);
  });

  it('rejects DB_POOL_SIZE outside [1,50]', () => {
    expect(envSchema.safeParse({ ...validEnv, DB_POOL_SIZE: '0' }).success).toBe(false);
    expect(envSchema.safeParse({ ...validEnv, DB_POOL_SIZE: '51' }).success).toBe(false);
  });

  it('loadEnv returns a typed bundle for an app', () => {
    const env = loadEnv(validEnv);
    expect(env.RATIO_GOOGLE_CLIENT_ID).toBe('goog_id');
    expect(env.RATIO_GOOGLE_ADMIN_BASE_URL).toBe('http://localhost:5173');
  });

  it('defaults TRUSTED_PROXY_CIDRS to RFC1918 + loopback and parses to string[]', () => {
    const env = loadEnv(validEnv);
    expect(env.TRUSTED_PROXY_CIDRS).toEqual([
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '127.0.0.0/8',
    ]);
  });

  it('TRUSTED_PROXY_CIDRS parses a comma-separated override with whitespace tolerance', () => {
    const env = loadEnv({ ...validEnv, TRUSTED_PROXY_CIDRS: ' 1.2.3.0/24 , 5.6.7.0/24 ' });
    expect(env.TRUSTED_PROXY_CIDRS).toEqual(['1.2.3.0/24', '5.6.7.0/24']);
  });
});
