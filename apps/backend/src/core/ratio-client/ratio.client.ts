import { HttpException, Logger } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

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
  private readonly logger = new Logger(RatioClient.name);

  constructor(private readonly baseUrl: string) {}

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
          throw new HttpException(
            { message: 'unexpected ratio response shape', error_code: 'RATIO_RESPONSE_VALIDATION' },
            502,
          );
        }
      } else {
        json = {};
      }

      if (!res.ok) {
        // Finding #12: do NOT log the upstream body verbatim.
        this.logger.error({ msg: 'ratio upstream error', url, status: res.status });
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
