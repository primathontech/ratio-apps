import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env.schema';

const GOOGLE_ONLY = {
  RATIO_API_BASE_URL: 'https://example.com',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  RATIO_GOOGLE_DATABASE_URL: 'mysql://app:app@localhost:3306/google_app',
  RATIO_GOOGLE_DATA_ENCRYPTION_KEY: 'ZER+W8ntDaICK/JZqIsr93LZla/TgsP4VvLxT/iYFaY=',
  RATIO_GOOGLE_CLIENT_ID: 'x',
  RATIO_GOOGLE_CLIENT_SECRET: 'y',
  RATIO_GOOGLE_CALLBACK_URL: 'https://example.com/google/api/v1/oauth/callback',
  RATIO_GOOGLE_ADMIN_BASE_URL: 'https://example.com/google',
};

afterEach(() => {
  delete process.env.ENABLED_MODULES;
});

describe('env validation scoped to ENABLED_MODULES', () => {
  it('accepts a google-only env when ENABLED_MODULES=google (no meta vars)', () => {
    process.env.ENABLED_MODULES = 'google';
    expect(() => loadEnv({ ...GOOGLE_ONLY, ENABLED_MODULES: 'google' })).not.toThrow();
  });

  it('rejects the same env when all modules are required', () => {
    process.env.ENABLED_MODULES = 'all';
    expect(() => loadEnv({ ...GOOGLE_ONLY, ENABLED_MODULES: 'all' })).toThrow(/META/);
  });
});
