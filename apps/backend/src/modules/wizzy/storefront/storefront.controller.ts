import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { WizzyApiClient } from '../catalog/wizzy-api.client';
import { StorefrontConfigService } from './storefront-config.service';

/** Whitelist the inbound event body — never forward an arbitrary client payload
 * to Wizzy under the merchant's credentials. */
export function sanitizeEventBody(raw: unknown): Record<string, unknown> {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(p.items)
    ? p.items.slice(0, 200).map((it) => {
        const i = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
        return {
          itemId: String(i.itemId ?? ''),
          position: Number(i.position) || 0,
          qty: Number(i.qty) || 1,
        };
      })
    : [];
  const out: Record<string, unknown> = {
    name: typeof p.name === 'string' ? p.name : '',
    searchResponseId: typeof p.searchResponseId === 'string' ? p.searchResponseId : '',
    items,
  };
  if (typeof p.source === 'string') out.source = p.source;
  if (typeof p.id === 'string') out.id = p.id;
  if (typeof p.value === 'number' && Number.isFinite(p.value)) out.value = p.value;
  // `qty` (total item quantity) is REQUIRED by Wizzy's ConvertedEvent alongside
  // `value`; whitelist it so the purchase event isn't rejected.
  if (typeof p.qty === 'number' && Number.isFinite(p.qty)) out.qty = p.qty;
  return out;
}

/** The three built SDK bundles served from `packages/wizzy-sdk/dist`. */
type SdkBundle = 'wizzy-loader.js' | 'wizzy-widget.js' | 'wizzy-results.js';

/**
 * PUBLIC storefront endpoints (no merchant guard) — these are loaded directly
 * by merchant storefronts in the browser, so every response sets a permissive
 * CORS header.
 *
 * Serves the three built SDK bundles from `packages/wizzy-sdk/dist` (cached in
 * memory after first read) plus the redacted public config for a merchant.
 *
 * All four routes use `@Res() reply: FastifyReply` and send via `reply.send()`
 * to bypass the global ResponseInterceptor, which would otherwise wrap the raw
 * JS/JSON in a `{ status_code, message, data }` envelope and break the SDK.
 */
@Controller('wizzy/sdk')
export class StorefrontController {
  /** First-read cache of bundle contents, keyed by file name. */
  private readonly bundleCache = new Map<string, string>();

  constructor(
    private readonly cfg: StorefrontConfigService,
    private readonly wizzy: WizzyApiClient,
  ) {}

  /**
   * Server-to-server analytics events. The storefront BFF forwards click /
   * converted events here (it only holds public creds); this endpoint resolves
   * the merchant's decrypted store secret and sends to Wizzy with the required
   * 3-header auth. Always 200 + no-op when not configured / search disabled /
   * bad kind, and fire-and-forget — analytics never breaks the caller.
   */
  @Post('events/:merchantId')
  async events(
    @Param('merchantId') merchantId: string,
    @Body() body: { kind?: string; payload?: unknown; userId?: unknown },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.header('access-control-allow-origin', '*').header('cache-control', 'no-store');
    try {
      const kind = body?.kind;
      const creds = await this.cfg.resolveEventCreds(merchantId);
      if (!creds || (kind !== 'click' && kind !== 'converted')) {
        reply.send({ ok: false });
        return;
      }
      // Stable anonymous visitor id → x-wizzy-userId header (attribution).
      const userId = typeof body?.userId === 'string' ? body.userId : undefined;
      void this.wizzy.sendEvent(
        creds.storeId,
        creds.storeSecret,
        creds.apiKey,
        kind,
        sanitizeEventBody(body?.payload),
        userId,
      );
      reply.send({ ok: true });
    } catch {
      reply.send({ ok: false });
    }
  }

  @Get('wizzy-loader.js')
  loader(@Res() reply: FastifyReply): void {
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=3600')
      .send(this.readBundle('wizzy-loader.js'));
  }

  @Get('wizzy-widget.js')
  widget(@Res() reply: FastifyReply): void {
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=3600')
      .send(this.readBundle('wizzy-widget.js'));
  }

  @Get('wizzy-results.js')
  results(@Res() reply: FastifyReply): void {
    reply
      .header('content-type', 'text/javascript; charset=utf-8')
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'public, max-age=3600')
      .send(this.readBundle('wizzy-results.js'));
  }

  @Get('config/:merchantId')
  async config(
    @Param('merchantId') merchantId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply
      .header('access-control-allow-origin', '*')
      .header('cache-control', 'no-store')
      .send(await this.cfg.publicConfig(merchantId));
  }

  /**
   * Resolve the built SDK dist directory. Mirrors the runtime path-resolution
   * pattern in `configure-app.ts`: `cwd` is the repo root in dev, PM2, and
   * Docker, and the SDK build lives at `<root>/packages/wizzy-sdk/dist`.
   * `WIZZY_SDK_DIST` overrides for non-standard layouts.
   */
  private distDir(): string {
    return process.env.WIZZY_SDK_DIST ?? resolve(process.cwd(), 'packages/wizzy-sdk/dist');
  }

  /** Read (and memoize) a built bundle; 404 if it hasn't been built. */
  private readBundle(name: SdkBundle): string {
    const cached = this.bundleCache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const contents = readFileSync(resolve(this.distDir(), name), 'utf8');
      this.bundleCache.set(name, contents);
      return contents;
    } catch {
      throw new NotFoundException(`SDK bundle not found: ${name}. Build @ratio-app/wizzy-sdk.`);
    }
  }
}
