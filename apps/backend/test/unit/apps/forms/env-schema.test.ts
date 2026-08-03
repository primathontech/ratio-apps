import { describe, expect, it } from 'vitest';
import { envSchema, loadEnv } from '@/config/env.schema';

const ENC = Buffer.alloc(32).toString('base64');
const app = (upper: string, port = '5173') => ({
  [`RATIO_${upper}_DATABASE_URL`]: `mysql://app:app@localhost:3306/${upper.toLowerCase()}_app`,
  [`RATIO_${upper}_DATA_ENCRYPTION_KEY`]: ENC,
  [`RATIO_${upper}_CLIENT_ID`]: `${upper.toLowerCase()}_id`,
  [`RATIO_${upper}_CLIENT_SECRET`]: `${upper.toLowerCase()}_secret`,
  [`RATIO_${upper}_CALLBACK_URL`]: `http://localhost:3000/${upper.toLowerCase()}/api/v1/oauth/callback`,
  [`RATIO_${upper}_ADMIN_BASE_URL`]: `http://localhost:${port}`,
});

const validEnv = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  PORT: '3000',
  RATIO_API_BASE_URL: 'https://sandbox-os-ecosystem.dev.gokwik.io',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  ...app('GOOGLE'),
  ...app('META'),
  ...app('POSTHOG'),
  ...app('MOENGAGE', '5174'),
  ...app('WIZZY', '5174'),
  ...app('RP', '5174'),
  ...app('LOYALTY', '5174'),
  ...app('FORMS', '5174'),
};

describe('FORMS_* env boot validation', () => {
  it('parses with all FORMS_* keys blank/unset', () => {
    const parsed = envSchema.safeParse(validEnv);
    expect(parsed.success).toBe(true);
  });

  it('applies the call-site defaults for worker flags and visibility', () => {
    const env = loadEnv(validEnv);
    expect(env.FORMS_WEBHOOK_WORKER_ENABLED).toBe('false');
    expect(env.FORMS_EMAIL_WORKER_ENABLED).toBe('false');
    expect(env.FORMS_EXPORT_WORKER_ENABLED).toBe('false');
    expect(env.FORMS_WEBHOOK_VISIBILITY).toBe(120);
    expect(env.FORMS_EMAIL_VISIBILITY).toBe(120);
    expect(env.FORMS_EXPORT_VISIBILITY).toBe(300);
    expect(env.FORMS_S3_REGION).toBe('ap-south-1');
  });

  it("rejects a mistyped worker flag ('True')", () => {
    expect(
      envSchema.safeParse({ ...validEnv, FORMS_WEBHOOK_WORKER_ENABLED: 'True' }).success,
    ).toBe(false);
  });

  it('rejects a blank visibility', () => {
    expect(envSchema.safeParse({ ...validEnv, FORMS_WEBHOOK_VISIBILITY: '' }).success).toBe(false);
  });

  it('rejects a visibility below the 30s floor', () => {
    expect(envSchema.safeParse({ ...validEnv, FORMS_EXPORT_VISIBILITY: '0' }).success).toBe(false);
  });
});
