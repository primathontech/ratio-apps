import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APPS } from './apps';
import { GlobalExceptionFilter } from '../core/common/filters/global-exception.filter';
import { ResponseInterceptor } from '../core/common/interceptors/response.interceptor';
import { ZodValidationPipe } from '../core/common/pipes/zod-validation.pipe';

/**
 * Wires the cross-cutting Nest concerns shared by both the production
 * bootstrap (`main.ts`) and the e2e test bootstrap (`test/e2e/setup.ts`).
 *
 * Keeping this in one place prevents the two boot paths from drifting (which
 * is exactly how we ended up shipping un-enveloped prod responses while the
 * e2e suite happily green-bar'd).
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalPipes(new ZodValidationPipe());

  // Cookie parser — the OAuth callback sets HttpOnly cookies, and other
  // future handlers may read them. Registered with `onRequest` so the parsed
  // cookies are available to guards/filters.
  await app.register(cookie as never, { hook: 'onRequest' });

  // Security response headers. We disable CSP globally because the admin SPAs
  // and the Ratio iframe embed require per-route policies (set in their own
  // controllers if/when needed). COEP is disabled because the pixel SDK must
  // be cross-origin loadable from merchant storefronts, and CORP is set to
  // `cross-origin` for the same reason.
  await app.register(helmet as never, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin' },
  });

  // Single-artifact deploy: serve the built admin SPA from disk so one
  // process (Docker image / PM2 fork) ships both the API and the UI. Gated
  // behind SERVE_STATIC so local dev — which runs the admin on a separate
  // Vite server (:5173) with its own proxy — is unaffected.
  if (process.env.SERVE_STATIC === 'true') {
    await registerStaticAdmin(app);
  }
}

// The admin SPA served by the single-artifact deploy. Slug-driven: serve the
// first real vendor in APPS (the leading-underscore `_template` is the
// scaffolder copy-source, never shipped). `SERVE_ADMIN_SLUG` overrides for a
// deploy that ships a different vendor's admin. The vendor module's API/SDK/auth
// routes live under `/<slug>/api`, `/<slug>/sdk`, `/<slug>/auth`; everything else
// under `/<slug>/*` is the client-side-routed SPA.
const ADMIN_SLUG =
  process.env.SERVE_ADMIN_SLUG ?? APPS.find((a) => !a.startsWith('_')) ?? '_template';
const ADMIN_URL_PREFIX = `/${ADMIN_SLUG}/`;

/**
 * Registers @fastify/static to serve the built `admin-<slug>` SPA and provides
 * an SPA fallback (unmatched `/<slug>/*` paths → index.html) so TanStack
 * Router's client-side routes survive a hard refresh / deep link.
 *
 * Path layout assumption (must match the Dockerfile and the PM2 `cwd` in
 * ecosystem.config.cjs): the process runs with `cwd` = repo root and the admin
 * build lives at `<root>/apps/admin-<slug>/dist`. The Docker runtime stage
 * copies the admin dist to exactly that path and sets WORKDIR to the repo root,
 * so this resolves identically in dev, PM2, and Docker. `SERVE_STATIC_ROOT` can
 * override the directory for non-standard layouts.
 */
async function registerStaticAdmin(app: NestFastifyApplication): Promise<void> {
  const root =
    process.env.SERVE_STATIC_ROOT ?? resolve(process.cwd(), `apps/admin-${ADMIN_SLUG}/dist`);

  // Fail fast at boot if the build artifact is missing (e.g. SERVE_STATIC=true
  // but the admin was never built / not copied into the image) instead of
  // 404ing every page silently at request time.
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(
      `SERVE_STATIC=true but admin build not found at ${join(root, 'index.html')}. ` +
        `Build the admin (pnpm --filter @ratio-app/admin-${ADMIN_SLUG} build) or set SERVE_STATIC_ROOT.`,
    );
  }

  const instance = app.getHttpAdapter().getInstance();

  // Register @fastify/static + the SPA fallback inside an ENCAPSULATED child
  // plugin scope mounted at the admin prefix (`ADMIN_URL_PREFIX`, i.e.
  // `/<slug>/`). The encapsulation + distinct prefix matter:
  // `setNotFoundHandler` is scoped to its registering context, so binding it
  // inside this `/<slug>`-prefixed plugin governs ONLY requests that fall
  // through to this context (paths under `/<slug>/*` that @fastify/static can't
  // resolve to a real file). It does NOT collide with the root (`/`) not-found
  // handler NestJS installs during `app.init()`, so non-admin 404s keep flowing
  // through the Nest pipeline as JSON error envelopes.
  await instance.register(
    async (scope) => {
      await scope.register(fastifyStatic as never, {
        // No `prefix` here — the parent `register` already prefixes this scope
        // with `/<slug>`, so files serve at `/<slug>/<file>`. Assets are emitted
        // with a relative `base: './'` in vite.config.ts, so
        // `/<slug>/index.html` resolves `./assets/*` to `/<slug>/assets/*` —
        // which this serves.
        root,
        // Serve index.html for the prefix root (`GET /<slug>/`).
        index: 'index.html',
        // `wildcard: false` makes @fastify/static fall through to this scope's
        // not-found handler (instead of registering its own catch-all wildcard
        // route) when a path under the prefix doesn't map to a real file —
        // that's what powers the SPA fallback below.
        wildcard: false,
      });

      // SPA fallback: an unresolved GET under `/<slug>/*` is a client-side
      // route — return index.html so TanStack Router can take over on a hard
      // refresh / deep link. Anything else 404s normally.
      scope.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply): FastifyReply => {
        if (req.method === 'GET') {
          // `sendFile` is decorated onto the reply by @fastify/static.
          return (
            reply as FastifyReply & { sendFile: (path: string, root: string) => FastifyReply }
          ).sendFile('index.html', root);
        }
        // Non-GET fallthrough: hand back to Fastify's default 404. `callNotFound`
        // returns void, so return the reply to satisfy the handler signature.
        reply.callNotFound();
        return reply;
      });
    },
    { prefix: ADMIN_URL_PREFIX },
  );
}
