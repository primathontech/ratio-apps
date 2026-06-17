import { z } from 'zod';
import { APPS } from './apps';

/**
 * Wrap an optional env var so a present-but-EMPTY string (`KEY=` in a .env, which
 * dotenv loads as `''`) is treated as unset rather than failing the inner
 * validation. Keeps `.env.example`'s blank placeholders valid while still
 * validating any non-empty value provided.
 */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}

const baseEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  RATIO_API_BASE_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string(),
  // DB_POOL_SIZE: per-module Kysely pool size. Default 5; capped at 50 to
  // prevent accidentally exhausting MySQL `max_connections` when scaled
  // (replicas × modules × poolSize). Budget: keep total ≤ 0.6 × max_connections.
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  // TRUSTED_PROXY_CIDRS: comma-separated CIDR list passed to Fastify's
  // trustProxy. Default covers RFC1918 + loopback (right for internal LBs
  // like AWS ALB / GKE / EKS). CDN-direct deploys (CloudFront, Cloudflare,
  // Akamai) must override with the CDN's published egress CIDRs — those POPs
  // terminate from PUBLIC IPs and aren't in private space.
  TRUSTED_PROXY_CIDRS: z
    .string()
    .default('10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8')
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  // SERVE_STATIC: when 'true', the backend serves the built admin SPA from
  // disk via @fastify/static (single-artifact deploy — see configure-app.ts).
  // Default false so local dev (separate Vite server on :5173) is unaffected.
  // Accepts only the literal strings 'true' / 'false'; coerced to boolean.
  SERVE_STATIC: z
    .enum(['true', 'false'])
    .default('false')
    .transform((s) => s === 'true'),

  // ─── google app: Google's own OAuth client ────────────────────────────────
  // The `google` vendor connects merchants to Google (Analytics/Ads/Merchant
  // Center) via Google's OAuth. These creds are distinct from the Ratio app
  // creds (`RATIO_GOOGLE_CLIENT_*`) the per-slug block below derives. Optional:
  // the manual service-account-key path works without them, so deployments that
  // only use manual config need not set these. `.env.example` ships them blank,
  // so an empty string is coerced to "unset" (undefined) rather than rejected.
  RATIO_GOOGLE_GOOGLE_CLIENT_ID: emptyAsUndefined(z.string().min(1)),
  RATIO_GOOGLE_GOOGLE_CLIENT_SECRET: emptyAsUndefined(z.string().min(1)),
  RATIO_GOOGLE_GOOGLE_REDIRECT_URI: emptyAsUndefined(z.string().url()),
});

export const envSchema = APPS.reduce((schema, app) => {
  const upper = app.toUpperCase();
  return z.object({
    ...schema.shape,
    [`RATIO_${upper}_DATABASE_URL`]: z.string().min(1),
    // Encryption key validation in three layers:
    //   1. `.transform(trim)` strips accidental whitespace (the most common
    //      paste-from-clipboard failure mode).
    //   2. Strict regex `/^[A-Za-z0-9+/]{43}=$/` rejects anything that isn't
    //      EXACTLY a canonical 44-char base64-encoded 32 bytes — whitespace,
    //      non-base64 chars, and over-long inputs that Node's permissive
    //      base64 parser would silently truncate to a valid 32-byte buffer.
    //   3. Decode-length check is belt-and-suspenders; the regex already
    //      guarantees 32 bytes for any string that matches.
    [`RATIO_${upper}_DATA_ENCRYPTION_KEY`]: z
      .string()
      .min(1, `RATIO_${upper}_DATA_ENCRYPTION_KEY is required`)
      .transform((s) => s.trim())
      .refine((k) => /^[A-Za-z0-9+/]{43}=$/.test(k), {
        message: `RATIO_${upper}_DATA_ENCRYPTION_KEY must be 44-char base64 (32 bytes)`,
      })
      .refine((k) => Buffer.from(k, 'base64').length === 32, {
        message: `RATIO_${upper}_DATA_ENCRYPTION_KEY decode-length mismatch`,
      }),
    [`RATIO_${upper}_CLIENT_ID`]: z.string().min(1),
    [`RATIO_${upper}_CLIENT_SECRET`]: z.string().min(1),
    [`RATIO_${upper}_CALLBACK_URL`]: z.string().url(),
    [`RATIO_${upper}_ADMIN_BASE_URL`]: z.string().url(),
  });
}, baseEnv);

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: Record<string, unknown> = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i: { path: PropertyKey[]; message: string }) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data as Env;
}
