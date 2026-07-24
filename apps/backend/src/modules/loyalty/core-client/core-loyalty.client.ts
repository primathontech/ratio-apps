import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { RatioTokenProvider } from '../oauth/ratio-token.provider';

/**
 * THE single guarded client for the Core Loyalty Service — the only four
 * endpoints that exist in UAT (verified against the live OpenAPI spec):
 *
 *   POST /api/v1/loyalty/points/credit    (idempotency_key REQUIRED)
 *   POST /api/v1/loyalty/points/debit     (idempotency_key REQUIRED)
 *   GET  /api/v1/loyalty/points/{phone}/balance
 *   GET  /api/v1/loyalty/points/{phone}/history
 *
 * All four use the `bearer` (Merchant JWT) scheme — we send the merchant's
 * stored OAuth access token via {@link RatioTokenProvider}. On a 401 the token
 * is force-refreshed once and the call retried. 429/5xx retry twice with
 * backoff. 4xx map to a typed {@link CoreLoyaltyError} — never a silent drop.
 *
 * Finding #12 rule: error logs carry `{ msg, path, status }` only — NEVER the
 * upstream response body (it could echo tokens/PII).
 */

export const pointsResponseSchema = z.object({
  phone: z.string(),
  new_balance: z.number(),
  transaction_id: z.string(),
});
export type CorePointsResponse = z.infer<typeof pointsResponseSchema>;

export const balanceResponseSchema = z.object({
  phone: z.string(),
  points_balance: z.number(),
  points_earned_lifetime: z.number(),
  points_redeemed_lifetime: z.number(),
  points_expired_lifetime: z.number(),
  points_adjusted_lifetime: z.number(),
});
export type CoreBalanceResponse = z.infer<typeof balanceResponseSchema>;

export const historyResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  pagination: z.record(z.string(), z.unknown()),
});
export type CoreHistoryResponse = z.infer<typeof historyResponseSchema>;

export type CoreLoyaltyErrorKind =
  | 'insufficient_balance'
  | 'not_found'
  | 'bad_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response';

export class CoreLoyaltyError extends Error {
  constructor(
    public readonly kind: CoreLoyaltyErrorKind,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CoreLoyaltyError';
  }
}

export interface CreditDebitInput {
  merchantId: string;
  phone: string;
  points: number;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 250;
const TIMEOUT_MS = 5_000;

/**
 * Constructed by a `useFactory` provider (token `LOYALTY_CORE_CLIENT`) so the
 * base URL comes from config and tests inject a fake fetch.
 */
export class CoreLoyaltyClient {
  private readonly logger = new Logger(CoreLoyaltyClient.name);
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly tokens: Pick<RatioTokenProvider, 'getAccessToken'>,
    opts: { baseUrl: string; fetchImpl?: typeof fetch },
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  credit(input: CreditDebitInput): Promise<CorePointsResponse> {
    return this.points('credit', input);
  }

  debit(input: CreditDebitInput): Promise<CorePointsResponse> {
    return this.points('debit', input);
  }

  async balance(merchantId: string, phone: string): Promise<CoreBalanceResponse> {
    const json = await this.request(
      merchantId,
      'GET',
      `/api/v1/loyalty/points/${encodeURIComponent(phone)}/balance`,
    );
    return this.parse(balanceResponseSchema, json, 'balance');
  }

  async history(
    merchantId: string,
    phone: string,
    page = 1,
    limit = 20,
  ): Promise<CoreHistoryResponse> {
    const json = await this.request(
      merchantId,
      'GET',
      `/api/v1/loyalty/points/${encodeURIComponent(phone)}/history?page=${page}&limit=${limit}`,
    );
    return this.parse(historyResponseSchema, json, 'history');
  }

  private async points(
    op: 'credit' | 'debit',
    input: CreditDebitInput,
  ): Promise<CorePointsResponse> {
    const json = await this.request(input.merchantId, 'POST', `/api/v1/loyalty/points/${op}`, {
      phone: input.phone,
      points: input.points,
      idempotency_key: input.idempotencyKey,
      ...(input.description ? { description: input.description } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return this.parse(pointsResponseSchema, json, op);
  }

  private parse<T>(schema: z.ZodType<T>, json: unknown, ctx: string): T {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      this.logger.error({ msg: 'core loyalty response failed validation', ctx });
      throw new CoreLoyaltyError('invalid_response', 200, `malformed core ${ctx} response`);
    }
    return parsed.data;
  }

  /**
   * One HTTP attempt loop: 401 → force token refresh once → retry; 429/5xx →
   * up to {@link MAX_RETRIES} retries with linear backoff; other 4xx → typed
   * error immediately.
   */
  private async request(
    merchantId: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let refreshed = false;
    let attempt = 0;
    let token = await this.tokens.getAccessToken(merchantId);

    // Retry loop budget: transient retries + at most one 401-refresh pass.
    for (;;) {
      const res = await this.send(method, path, token, body);

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.tokens.getAccessToken(merchantId, { forceRefresh: true });
        continue;
      }

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        attempt += 1;
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }

      if (!res.ok) {
        this.logger.error({ msg: 'core loyalty call failed', path, status: res.status });
        throw new CoreLoyaltyError(
          kindForStatus(res.status, res.bodyText),
          res.status,
          `core loyalty ${res.status}`,
        );
      }

      try {
        return JSON.parse(res.bodyText);
      } catch {
        throw new CoreLoyaltyError('invalid_response', res.status, 'non-JSON core response');
      }
    }
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    token: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; bodyText: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const bodyText = await res.text();
      return { ok: res.ok, status: res.status, bodyText };
    } catch (err) {
      // Network/timeout — surface as a retryable upstream error.
      return { ok: false, status: 503, bodyText: err instanceof Error ? err.name : 'fetch_error' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function kindForStatus(status: number, bodyText: string): CoreLoyaltyErrorKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  // Core signals an over-balance debit as a 4xx; recognize it without ever
  // logging the body itself.
  if (/insufficient/i.test(bodyText)) return 'insufficient_balance';
  return 'bad_request';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
