import { HttpException, Logger } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';
import { redactSensitive, toCurl } from '../common/redact';

export interface RatioRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Outbound client for Ratio's platform API. App-parametrized: callers pass the
 * per-app `clientId`/`clientSecret`/`redirectUri` as request body fields, so
 * this client doesn't hold any per-app secret.
 *
 * Finding #12: error logs include `{ msg, url, status }` only — NEVER the
 * upstream response body, which may echo `client_secret` / `code` / etc.
 * that the pino redact list doesn't catch.
 */
export class RatioClient {
  private readonly logger: Logger;

  constructor(
    private readonly baseUrl: string,
    loggerContext: string = RatioClient.name,
  ) {
    this.logger = new Logger(loggerContext);
  }

  async request<T>(
    path: string,
    schema: ZodType<T>,
    options: RatioRequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

    try {
      const init: RequestInit = {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
          ...options.headers,
        },
        signal: controller.signal,
      };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);

      // DEBUG-only (LOG_LEVEL=debug) — the exact outbound call, headers/body
      // redacted via redactSensitive so it's safe to leave enabled without
      // leaking the bearer token or any credential-shaped field. This is the
      // "what full curl did we actually hit Ratio with" trail for debugging
      // upstream failures (e.g. a malformed path) without re-deriving it
      // from source every time.
      const requestHeaders = init.headers as Record<string, string>;
      this.logger.debug({
        msg: 'ratio outbound request',
        method: init.method,
        url,
        headers: redactSensitive(requestHeaders),
        body: options.body,
        curl: toCurl(init.method as string, url, redactSensitive(requestHeaders) as Record<string, string>, options.body),
      });

      const res = await fetch(url, init);

      const raw = await res.text();
      let json: unknown;
      if (raw.length > 0) {
        try {
          json = JSON.parse(raw);
        } catch {
          // Malformed upstream body would otherwise bubble a SyntaxError up
          // through the GlobalExceptionFilter as a generic 500. Convert to a
          // 502 with the same error code as the schema-validation branch so
          // callers see a uniform "ratio responded with something we can't
          // trust" signal.
          this.logger.error({
            msg: 'ratio response not parseable as JSON',
            url,
            status: res.status,
          });
          // DEBUG only (opt-in via LOG_LEVEL=debug) — the raw text is
          // unstructured, so redactSensitive (which only redacts object
          // keys) can't guarantee it's credential-free. Keeping this behind
          // debug, separate from the always-on error log above, matches
          // Finding #12's caution: only surface it when someone has
          // deliberately turned on verbose logging to debug this.
          this.logger.debug({ msg: 'ratio response raw body (parse failure)', url, rawBodyPreview: raw.slice(0, 500) });
          throw new HttpException(
            { message: 'unexpected ratio response shape', error_code: 'RATIO_RESPONSE_VALIDATION' },
            502,
          );
        }
      } else {
        json = {};
      }

      if (!res.ok) {
        // Finding #12: do NOT log the upstream body verbatim at error level
        // (always-on in prod) — it may echo client_secret/code/etc. that the
        // pino redact list doesn't catch.
        this.logger.error({ msg: 'ratio upstream error', url, status: res.status });
        // DEBUG only (opt-in via LOG_LEVEL=debug) — redacted (known
        // credential-shaped keys stripped), so this is the "why did it fail"
        // detail Finding #12's always-on error log deliberately omits.
        this.logger.debug({
          msg: 'ratio upstream error body',
          url,
          status: res.status,
          body: redactSensitive(json),
        });
        throw new HttpException(
          {
            message: 'ratio upstream error',
            error_code: 'RATIO_UPSTREAM_ERROR',
            details: { status: res.status },
          },
          502,
        );
      }

      try {
        return schema.parse(json) as T;
      } catch (err) {
        if (err instanceof ZodError) {
          this.logger.error({ msg: 'ratio response failed schema', url, issues: err.issues });
        }
        throw new HttpException(
          {
            message: 'unexpected ratio response shape',
            error_code: 'RATIO_RESPONSE_VALIDATION',
          },
          502,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
