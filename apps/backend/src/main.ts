import 'reflect-metadata';
// Pick env file based on NODE_ENV — `.env.production` in prod, `.env` in dev/
// test. Set BEFORE the `dotenv/config` import below so dotenv reads the right
// file. In containerized deploys env vars usually come from the orchestrator
// (k8s ConfigMap / ECS task def) and these files are absent — dotenv silently
// no-ops when the file isn't there, so this is also safe.
process.env.DOTENV_CONFIG_PATH = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './config/configure-app';
import { resolveEnabledModules } from './config/enabled-modules';
import { loadEnv } from './config/env.schema';
import { HealthRegistry } from './core/health/health-registry.service';

type CorsOriginType = string | boolean | RegExp;
type CorsOriginCallback = (err: Error | null, origin: CorsOriginType | CorsOriginType[]) => void;
type CorsOriginFn = (origin: string | undefined, callback: CorsOriginCallback) => void;

function buildCorsOriginChecker(rawAllowed: string): CorsOriginFn {
  // Trust boundary: every host matched here is considered first-party. The
  // wildcard form `https://*.gokwik.in` matches any subdomain by exact suffix
  // (NOT substring) — so `evilgokwik.in` is NOT accepted because the proto
  // prefix must be `https://` and the host portion must END with `.gokwik.in`
  // (leading dot included via the `slice('https://*'.length)` math below).
  //
  // CAVEAT: if marketing or a 3rd-party tenant ever hosts on a `gokwik.in`
  // subdomain (e.g. `partner.gokwik.in`) the wildcard implicitly trusts them.
  // Audit the allowlist when onboarding tenants who control DNS under
  // gokwik.in / gokwik.io.
  const patterns = rawAllowed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      if (!p.startsWith('https://*.') && !p.startsWith('http://*.')) {
        return { kind: 'exact' as const, value: p };
      }
      const proto = p.startsWith('https://') ? 'https://' : 'http://';
      // `suffix` includes the leading dot, e.g. `.gokwik.in`. Combined with
      // the `origin.startsWith(proto)` check below this is a true suffix
      // match — `evilgokwik.in` fails because it doesn't end with the dotted
      // suffix `.gokwik.in`.
      const suffix = p.slice(`${proto}*`.length);
      return { kind: 'suffix' as const, proto, suffix };
    });

  return (origin, cb) => {
    if (!origin) return cb(null, true);
    for (const p of patterns) {
      if (p.kind === 'exact' && p.value === origin) return cb(null, true);
      if (p.kind === 'suffix' && origin.startsWith(p.proto) && origin.endsWith(p.suffix))
        return cb(null, true);
    }
    cb(null, false);
  };
}

async function bootstrap(): Promise<void> {
  // Validate env synchronously before Nest starts — catches bad config with a
  // clean error message before any module-load runs through pino. (loadEnv
  // is also called from inside ConfigModule.forRoot({ validate }); the
  // double-call is intentional and idempotent — the point is to fail-fast
  // before logger setup so config errors aren't swallowed by `bufferLogs`.)
  const env = loadEnv(process.env);
  // trustProxy as a CIDR list driven by TRUSTED_PROXY_CIDRS. Default covers
  // RFC1918 private ranges + loopback, which is right for AWS ALB / GKE / EKS
  // internal LBs where the LB egresses to us from private space. CDN-direct
  // deploys (CloudFront, Cloudflare, Akamai POPs) terminate from public
  // ranges that are NOT in private space — override the env var with the
  // CDN's published egress CIDRs in those topologies.
  //
  // Only X-Forwarded-For values originating from these source CIDRs are
  // honored; requests arriving directly from a public IP cannot spoof their
  // client IP. Trusting all proxies (`true` or `1`) allows X-Forwarded-For
  // spoofing if the LB doesn't strip the header — `1` trusts a single hop
  // regardless of source, so any upstream that talks to us through one proxy
  // hop can lie about client IP. The CIDR list pins the trust boundary to
  // the network shape.
  const adapter = new FastifyAdapter({
    trustProxy: env.TRUSTED_PROXY_CIDRS,
    bodyLimit: 1_048_576,
    // Honor inbound `X-Request-ID` for `req.id` (used by ResponseInterceptor +
    // GlobalExceptionFilter to set the response header + envelope field).
    // Without this Fastify mints sequential ids (`req-1`, `req-2`, ...) and
    // ignores upstream-provided correlation ids.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  // Wire global filter / interceptor / pipe + register helmet / cookie.
  // Shared with e2e setup so the two boot paths can't drift again.
  await configureApp(app);

  // Per-route rate limits (spec §3.6). `@fastify/rate-limit` accepts function
  // forms for `max` / `keyGenerator` so we can vary by URL without needing
  // controller-level Fastify route options (which NestJS doesn't expose).
  //
  // Per-route rate limits are defined here in URL-regex form. THIS IS THE
  // SOURCE OF TRUTH — there are no controller-level `@RateLimit()` decorators.
  // (An older `@RateLimit()` decorator was metadata-only and never plugged
  // into anything that enforced it; Fastify's `onRoute` lifecycle doesn't see
  // Nest-registered routes the same way as native ones, so the decorator
  // could never have driven enforcement. Deleted in A4.) Update both lists
  // when adding routes.
  //
  //   /<app>/sdk/<id>.js                — 600/min per (IP, merchantId)
  //   /<app>/api/v1/oauth/webhook        — 200/min per IP
  //   /<app>/api/v1/oauth/callback       — 10/min per IP
  //   /<app>/public/v1/ writes (POST/...) — 10/min per IP (public storefront
  //                                         form submissions + presigned
  //                                         uploads — the coarse DoS floor
  //                                         above the app-level 5-per-10-min
  //                                         business limiter; GET schema
  //                                         reads stay in the default bucket)
  //   /<app>/api/  writes (PUT/POST/...)  — 20/min per IP (was per IP+merchantId;
  //                                         the merchantId came from the
  //                                         Authorization header, which an
  //                                         attacker can rotate to mint
  //                                         unlimited buckets — see S1)
  //   default                              — 60/min per IP
  // Alternation derived from APPS so the rate-limit URL classifier doesn't
  // drift when new app slugs are added. The previous hardcoded
  // `(_template|_template)` would silently fall through to the default 60/min
  // bucket for any new app's routes — a quiet way for new modules to lose
  // their proper rate-limit behavior.
  //
  // Defense-in-depth: slugs from APPS are guaranteed lowercase-alphanumeric-dash
  // by the assertion in config/apps.ts, but escape regex metachars anyway so a
  // future relaxation of APPS validation can't introduce a smuggling vector.
  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const slugAlt = resolveEnabledModules().map(escapeRegex).join('|');
  const SDK_RE = new RegExp(`^/(${slugAlt})/sdk/([A-Za-z0-9_-]{1,128})\\.js(?:\\?|$)`);
  const OAUTH_CALLBACK_RE = new RegExp(`^/(${slugAlt})/api/v1/oauth/callback(?:\\?|$)`);
  const OAUTH_WEBHOOK_RE = new RegExp(`^/(${slugAlt})/api/v1/oauth/webhook(?:\\?|$)`);
  const PUBLIC_SUBMIT_RE = new RegExp(`^/(${slugAlt})/public/v1/`);
  const API_WRITE_RE = new RegExp(`^/(${slugAlt})/api/`);

  function classify(url: string, method: string): { max: number; kind: 'ip' | 'sdk' } {
    // The SDK bucket is the only one that may key on a non-IP component —
    // and that component (`merchantId`) is derived from the URL path, which
    // an attacker cannot rotate without changing which merchant's SDK they
    // download. Every other bucket keys on IP only to prevent header-driven
    // bucket bypass (S1).
    if (SDK_RE.test(url)) return { max: 600, kind: 'sdk' };
    if (OAUTH_WEBHOOK_RE.test(url)) return { max: 200, kind: 'ip' };
    if (OAUTH_CALLBACK_RE.test(url)) return { max: 10, kind: 'ip' };
    if (
      PUBLIC_SUBMIT_RE.test(url) &&
      method !== 'GET' &&
      method !== 'HEAD' &&
      method !== 'OPTIONS'
    ) {
      // Public storefront writes (form submissions, presigned uploads): the
      // edge DoS floor. Schema GETs fall through to the default bucket.
      return { max: 10, kind: 'ip' };
    }
    if (API_WRITE_RE.test(url) && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return { max: 20, kind: 'ip' };
    }
    return { max: 60, kind: 'ip' };
  }

  function extractMerchantIdFromUrl(url: string): string | undefined {
    const sdkMatch = url.match(SDK_RE);
    if (sdkMatch) return sdkMatch[2];
    return undefined;
  }

  await app.register(rateLimit as never, {
    global: true,
    timeWindow: '1 minute',
    max: (req: FastifyRequest) => classify(req.url, req.method).max,
    keyGenerator: (req: FastifyRequest) => {
      const { kind } = classify(req.url, req.method);
      if (kind === 'sdk') {
        // SDK bucket: merchantId is URL-path-derived (not header-derived), so
        // an attacker cannot rotate it to bypass the limit.
        const id = extractMerchantIdFromUrl(req.url) ?? 'unknown';
        return `${req.ip}:${id}`;
      }
      // All other buckets key on IP only. The trustProxy CIDR list above
      // ensures `req.ip` is the real client IP — XFF is honored only when
      // the request arrives from a configured private CIDR (LB egress), not
      // from arbitrary upstream that could spoof the header.
      return req.ip;
    },
    // 429s bypass the GlobalExceptionFilter (rate-limit short-circuits before
    // Nest's request pipeline runs), so build the envelope here so clients
    // see the same shape as every other error response.
    errorResponseBuilder: (_req: FastifyRequest, ctx: { after: string; max: number }) => ({
      status_code: 429,
      message: 'too many requests',
      error_code: 'RATE_LIMITED',
      details: { retryAfter: ctx.after, max: ctx.max },
    }),
  });

  app.enableCors({
    origin: buildCorsOriginChecker(env.ALLOWED_ORIGINS),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.enableShutdownHooks();

  // Flip /ready from `503 booting` to live probe aggregation BEFORE listen()
  // accepts connections. All module init (probe registration in
  // `<App>KyselyModule.onModuleInit`) has already completed by this point.
  // Marking before listen() also closes the microtask window between
  // listen-resolved and markBooted-called where /ready would have lied.
  app.get(HealthRegistry).markBooted();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  // Use Nest's Logger (routed through pino via `app.useLogger`) so the
  // startup line is structured / redacted / correlated with the rest of the
  // log stream. The outer bootstrap().catch() below keeps `console.error`
  // because logger setup may not be up if we crashed before this point.
  new NestLogger('Bootstrap').log({ msg: 'listening', port: env.PORT });
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
  process.exit(1);
});
