import { Logger } from '@nestjs/common';
import type { RatioTokenProvider } from '../oauth/ratio-token.provider';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 200;
const TIMEOUT_MS = 15_000;

export interface ClevertapProductSource {
  fetchAllProducts(merchantId: string): Promise<Record<string, unknown>[]>;
}

export type ClevertapProductSourceFactory = () => ClevertapProductSource;

export class RatioProductSourceClient implements ClevertapProductSource {
  private readonly logger = new Logger(RatioProductSourceClient.name);
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly tokens: Pick<RatioTokenProvider, 'getAccessToken'>,
    opts: { baseUrl: string; fetchImpl?: typeof fetch },
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async fetchAllProducts(merchantId: string): Promise<Record<string, unknown>[]> {
    let token = await this.tokens.getAccessToken(merchantId);
    const all: Record<string, unknown>[] = [];
    let refreshed = false;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = `${this.baseUrl}/api/v1/v1/products?limit=${DEFAULT_PAGE_SIZE}&page=${page}&show_variants=false`;
      const res = await this.send(url, token);

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.tokens.getAccessToken(merchantId, { forceRefresh: true });
        page -= 1;
        continue;
      }
      if (!res.ok) {
        throw new Error(`ratio products ${res.status}`);
      }

      const body = safeParse(res.bodyText);
      const products = Array.isArray(body.products)
        ? (body.products as Record<string, unknown>[])
        : [];
      all.push(...products);

      const pagination = asRecord(body.pagination);
      if (pagination.hasNext !== true || products.length === 0) break;
    }

    return all;
  }

  private async send(
    url: string,
    token: string,
  ): Promise<{ ok: boolean; status: number; bodyText: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status, bodyText: await res.text() };
    } catch (err) {
      this.logger.error({
        msg: 'ratio products fetch failed',
        reason: err instanceof Error ? err.name : 'fetch_error',
      });
      return { ok: false, status: 0, bodyText: '' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
