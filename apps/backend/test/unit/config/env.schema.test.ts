import { describe, expect, it } from 'vitest';
import { APPS } from '@/config/apps';
import { envSchema, loadEnv } from '@/config/env.schema';

// Buffer.alloc(32).toString('base64') is `'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='`
// — exactly 44 chars, matches the strict `/^[A-Za-z0-9+/]{43}=$/` shape.
const ENC = Buffer.alloc(32).toString('base64');

const appKeys = (upper: string) => ({
  [`RATIO_${upper}_DATABASE_URL`]: `mysql://app:app@localhost:3306/${upper.toLowerCase()}_app`,
  [`RATIO_${upper}_DATA_ENCRYPTION_KEY`]: ENC,
  [`RATIO_${upper}_CLIENT_ID`]: `${upper.toLowerCase()}_id`,
  [`RATIO_${upper}_CLIENT_SECRET`]: `${upper.toLowerCase()}_secret`,
  [`RATIO_${upper}_CALLBACK_URL`]: `http://localhost:3000/${upper.toLowerCase()}/api/v1/oauth/callback`,
  [`RATIO_${upper}_ADMIN_BASE_URL`]: 'http://localhost:5173',
});

/**
 * The per-app block is DERIVED from APPS, never hand-listed: the schema
 * requires a full `RATIO_<APP>_*` set for every entry, so a hardcoded fixture
 * goes red the day someone adds an app — which is exactly how adding
 * `loyalty` broke this suite without touching anything it actually tests.
 */
const validEnv: Record<string, string> = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  PORT: '3000',
  RATIO_API_BASE_URL: 'https://sandbox-os-ecosystem.dev.gokwik.io',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ...APPS.reduce<Record<string, string>>(
    (acc, slug) => Object.assign(acc, appKeys(slug.toUpperCase())),
    {},
  ),
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
    expect(env.RATIO_GOOGLE_CLIENT_ID).toBe('google_id');
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

  it('defaults RP_PLATFORM_KILL_SWITCH_ENABLED to "true"', () => {
    const env = loadEnv(validEnv);
    expect(env.RP_PLATFORM_KILL_SWITCH_ENABLED).toBe('true');
  });

  it('accepts RP_PLATFORM_KILL_SWITCH_ENABLED=false and rejects a non-boolean value', () => {
    expect(
      envSchema.safeParse({ ...validEnv, RP_PLATFORM_KILL_SWITCH_ENABLED: 'false' }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({ ...validEnv, RP_PLATFORM_KILL_SWITCH_ENABLED: 'off' }).success,
    ).toBe(false);
  });
});
