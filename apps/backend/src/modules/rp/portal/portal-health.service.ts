import { Injectable, Logger } from '@nestjs/common';

/** How long we're willing to block the customer's own portal request while probing RP's
 *  health. This is a synchronous gate on a real request (unlike the client-side SDK's
 *  8s iframe-load budget, which doesn't block a response) so it must stay tight. */
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/** Best-effort per-process cache so a burst of customers hitting the same broken (or
 *  healthy) shop doesn't re-probe RP on every single request. Not distributed/Redis —
 *  a per-instance cache is intentional and sufficient here. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  healthy: boolean;
  expiresAt: number;
}

// Best-effort scan for <script src="..."> and <link rel="stylesheet" href="..."> tags
// referencing an absolute http(s) URL. Not a real HTML parser — this only needs to catch
// the common "asset hosted on a separate CDN origin" case, not handle every possible markup.
const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const LINK_STYLESHEET_RE = /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const LINK_STYLESHEET_HREF_FIRST_RE =
  /<link\b[^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*\brel=["']stylesheet["'][^>]*>/gi;

/**
 * Server-side health check for RP's hosted customer portal, run before `RpPortalController`
 * redirects a customer into it. Exists because RP's hosted portal has failed in two distinct,
 * observed-in-prod ways that a blind redirect can't detect:
 *  1. The shell itself is unreachable (a live 503 from an AWS ELB with no healthy backend).
 *  2. The shell returns 200, but the JS/CSS it references — hosted on a separate CDN origin
 *     (rp-web-assets.returnprime.co) — 403s (S3/CloudFront AccessDenied), so RP's own
 *     frontend never boots and the customer sees a blank iframe with no error.
 *
 * This only works server-side: CORS/cross-origin frame restrictions are a browser-JS concept
 * and don't apply to our own outbound `fetch()`, so the backend can read the full status and
 * body of both the portal HTML and any asset URLs it references with zero restriction.
 *
 * Fails OPEN (returns healthy) on any inconclusive signal — network error, timeout, or an
 * asset probe that itself errors — since an ambiguous result from our own flaky probe must
 * never block a customer from a portal that might be fine. Only a definitive negative (a
 * non-2xx status from the shell or from an external asset) suppresses the redirect.
 */
@Injectable()
export class RpPortalHealthService {
  private readonly logger = new Logger(`RP:${RpPortalHealthService.name}`);
  private readonly cache = new Map<string, CacheEntry>();

  async checkHealthy(targetUrl: string): Promise<boolean> {
    const cached = this.cache.get(targetUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.healthy;
    }

    const healthy = await this.probe(targetUrl);
    this.cache.set(targetUrl, { healthy, expiresAt: Date.now() + CACHE_TTL_MS });
    return healthy;
  }

  private async probe(targetUrl: string): Promise<boolean> {
    let res: Response;
    try {
      res = await this.fetchWithTimeout(targetUrl);
    } catch (err) {
      this.logger.warn(`Portal health check for ${targetUrl} failed/timed out — failing open: ${String(err)}`);
      return true;
    }

    if (!(res.status >= 200 && res.status < 300)) {
      return false;
    }

    let body: string;
    try {
      body = await res.text();
    } catch (err) {
      this.logger.warn(`Portal health check for ${targetUrl} — failed reading body, failing open: ${String(err)}`);
      return true;
    }

    const assetUrl = this.findFirstExternalAsset(body, targetUrl);
    if (!assetUrl) {
      return true;
    }

    try {
      const assetRes = await this.fetchWithTimeout(assetUrl, 'HEAD');
      if (assetRes.status === 405) {
        // Some CDNs/origins don't support HEAD — fall back to GET before concluding anything.
        const getRes = await this.fetchWithTimeout(assetUrl, 'GET');
        return getRes.status >= 200 && getRes.status < 300;
      }
      return assetRes.status >= 200 && assetRes.status < 300;
    } catch (err) {
      this.logger.warn(`Portal asset health check for ${assetUrl} failed/timed out — failing open: ${String(err)}`);
      return true;
    }
  }

  private findFirstExternalAsset(html: string, targetUrl: string): string | undefined {
    let targetOrigin: string;
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch {
      return undefined;
    }

    const candidates: string[] = [];
    for (const re of [SCRIPT_SRC_RE, LINK_STYLESHEET_RE, LINK_STYLESHEET_HREF_FIRST_RE]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard exec-loop idiom
      while ((match = re.exec(html))) {
        const url = match[1];
        if (url) candidates.push(url);
      }
    }

    for (const candidate of candidates) {
      try {
        if (new URL(candidate).origin !== targetOrigin) {
          return candidate;
        }
      } catch {
        /* ignore unparseable URL, keep scanning */
      }
    }
    return undefined;
  }

  private async fetchWithTimeout(url: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      return await fetch(url, { method, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
