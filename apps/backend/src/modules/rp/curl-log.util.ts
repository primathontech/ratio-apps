import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, tap } from 'rxjs';

// Debug-only visibility into RP<->adapter traffic. Lives entirely in ratio-apps —
// never touches return_prime_public's own logs.
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-os-internal-token']);

function redactHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : String(value);
  }
  return out;
}

function toCurl(method: string, url: string, headers: Record<string, string>, body?: string): string {
  const headerFlags = Object.entries(headers)
    .map(([key, value]) => `-H '${key}: ${value}'`)
    .join(' ');
  const bodyFlag = body ? ` --data-raw '${body}'` : '';
  return `curl -X ${method} '${url}' ${headerFlags}${bodyFlag}`.trim();
}

/** Wraps `fetch` for every adapter -> RP call: logs the exact curl fired at RP,
 *  then RP's response status/body, before returning the response untouched. */
export async function fetchWithCurlLog(url: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  const logger = new Logger('RP:curl');
  logger.log(`[adapter -> RP] ${toCurl(init.method ?? 'GET', url, redactHeaders(init.headers), init.body as string | undefined)}`);
  const res = await fetch(url, init);
  const bodyText = await res
    .clone()
    .text()
    .catch(() => '<unreadable>');
  logger.log(`[RP -> adapter] status=${res.status} body=${bodyText.slice(0, 2000)}`);
  return res;
}

/** Applied to every rp module controller: logs the exact curl equivalent of whatever
 *  fired the request in (RP's Shopify-compat calls, Ratio/OS webhooks, the admin SPA)
 *  and the adapter's response. Debug-only, adapter-side, no effect on RP's own logs. */
@Injectable()
export class RpCurlLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RP:curl');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const url = `${req.protocol}://${req.hostname}${req.url}`;
    const body = req.body ? JSON.stringify(req.body) : undefined;
    this.logger.log(`[fired at adapter] ${toCurl(req.method, url, redactHeaders(req.headers as Record<string, unknown>), body)}`);

    return next.handle().pipe(
      tap((responseBody) => {
        const res = context.switchToHttp().getResponse<FastifyReply>();
        this.logger.log(
          `[adapter response] status=${res.statusCode} body=${JSON.stringify(responseBody ?? {}).slice(0, 2000)}`,
        );
      }),
    );
  }
}
