import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { resolveEnabledModules } from './config/enabled-modules';
import { loadEnv } from './config/env.schema';
import { HealthModule } from './core/health/health.module';
import { MODULE_REGISTRY } from './module-registry';

// Re-export the canonical APPS tuple so call sites can keep importing it
// from the AppModule barrel. The source of truth lives in `./config/apps.ts`
// (loaded early by env.schema; pulling it from here would risk a cycle).
export { APPS, type AppSlug } from './config/apps';

// Mounted modules for THIS process (default: all). resolveEnabledModules reads
// process.env.ENABLED_MODULES at module-load (dotenv has already run in main.ts/
// main.worker.ts), so the decorator's imports[] is computed once at boot.
const ENABLED_MODULE_CLASSES = resolveEnabledModules().map((slug) => MODULE_REGISTRY.get(slug)!);

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? ['.env.production', '../../.env.production']
          : ['.env', '../../.env'],
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: loadEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : {
              transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
            }),
        customProps: () => ({ service: 'ratio-app-backend' }),
        // Honor an incoming `x-request-id` so upstream proxies / clients can
        // pin a correlation id; otherwise mint one. pino exposes this as
        // `req.id`, which the response interceptor & exception filter both
        // echo back to the client via `x-request-id` and `request_id`.
        genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
          const hdr = req.headers['x-request-id'];
          const v = Array.isArray(hdr) ? hdr[0] : hdr;
          return typeof v === 'string' && v ? v : randomUUID();
        },
        // Custom `req` serializer strips querystrings BEFORE logging so OAuth
        // `code` / `state` (and any other sensitive query params) never reach
        // the log sink. The pino `redact` paths below only see structured keys
        // — they can't reach into a URL string. Headers are intentionally NOT
        // logged here; sensitive header values are also covered by the redact
        // paths if any other code path serializes them.
        serializers: {
          req: (req: {
            url?: string;
            method?: string;
            headers?: Record<string, unknown>;
            id?: string;
          }) => ({
            method: req.method,
            url: typeof req.url === 'string' ? req.url.split('?')[0] : req.url,
            id: req.id,
          }),
        },
        // `req.headers.*` paths intentionally omitted — the `serializers.req`
        // above never emits the `headers` field, so headers are dropped at
        // serialization rather than redacted. The `*` (wildcard) paths below
        // still cover any other place sensitive keys could appear.
        redact: [
          'req.query.state',
          '*.state',
          '*.access_token',
          '*.refresh_token',
          '*.accessToken',
          '*.refreshToken',
          '*.code',
          '*.clientSecret',
          '*.client_secret',
          '*.token',
          '*.id_token',
          '*.idToken',
        ],
      },
    }),
    HealthModule,
    ...(ENABLED_MODULE_CLASSES as never[]),
  ],
})
export class AppModule {}
