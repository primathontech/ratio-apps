import { buildDefaultEventMap, type EventMap } from '@ratio-app/shared/schemas/event-map';
import { vi } from 'vitest';
import { CryptoService } from '../../../../../src/core/crypto/crypto.service';
import type {
  ClevertapConfigRow,
  ClevertapForwardedEventRow,
  ClevertapMerchantRow,
} from '../../../../../src/modules/clevertap/db/types';

export const MERCHANT_ID = 'merchant-1';
export const ACCOUNT_ID = 'TEST-ACCOUNT-ID';
export const PASSCODE = 'super-secret-passcode';

export function makeMerchant(overrides: Partial<ClevertapMerchantRow> = {}): ClevertapMerchantRow {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return {
    id: MERCHANT_ID,
    isActive: true,
    installedAt: now,
    uninstalledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ClevertapMerchantRow;
}

export function makeConfig(overrides: Partial<ClevertapConfigRow> = {}): ClevertapConfigRow {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return {
    merchantId: MERCHANT_ID,
    accountId: ACCOUNT_ID,
    passcodeEnc: null,
    region: 'in1',
    serverEventsEnabled: false,
    debug: false,
    catalogName: '',
    catalogEmail: '',
    catalogSyncEnabled: false,
    clevertapEnabled: true,
    chargedSource: 'server',
    events: buildDefaultEventMap('clevertap'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ClevertapConfigRow;
}

export function makeForwardedEvent(
  overrides: Partial<ClevertapForwardedEventRow> = {},
): ClevertapForwardedEventRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    merchantId: MERCHANT_ID,
    idempotencyKey: 'orders/paid:order-1001',
    topic: 'orders/paid',
    clevertapEvent: 'Charged',
    status: 'sent',
    error: null,
    sentAt: new Date('2026-07-25T10:00:00.000Z'),
    ...overrides,
  } as ClevertapForwardedEventRow;
}

export function makeEventMap(): EventMap {
  return buildDefaultEventMap('clevertap');
}

export function makeCrypto(): CryptoService {
  return new CryptoService(Buffer.alloc(32, 7));
}

export interface FakeFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export class FakeFetch {
  readonly calls: FakeFetchCall[] = [];
  readonly queue: { status: number; body?: unknown }[] = [];
  status = 200;
  responseBody: unknown = { status: 'success', processed: 1, unprocessed: [] };
  latencyMs = 0;
  throwOn: Error | null = null;

  get callCount(): number {
    return this.calls.length;
  }

  respondWith(status: number, body?: unknown): this {
    this.queue.push({ status, body });
    return this;
  }

  failWith(err: Error): this {
    this.throwOn = err;
    return this;
  }

  readonly impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    let body: unknown = rawBody;
    if (rawBody !== undefined) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    this.calls.push({
      url: String(typeof input === 'object' && 'url' in input ? input.url : input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: normalizeHeaders(init?.headers),
      body,
    });

    if (this.throwOn) {
      const err = this.throwOn;
      this.throwOn = null;
      throw err;
    }
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    const next = this.queue.shift();
    const status = next?.status ?? this.status;
    const payload = next?.body ?? this.responseBody;
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch & { mock: { calls: unknown[] } };

  get fetchImpl(): typeof fetch {
    return this.impl as unknown as typeof fetch;
  }
}

function normalizeHeaders(headers: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = String(v);
  return out;
}

export function makeFetch(
  init: Partial<Pick<FakeFetch, 'status' | 'responseBody'>> = {},
): FakeFetch {
  const f = new FakeFetch();
  if (init.status !== undefined) f.status = init.status;
  if (init.responseBody !== undefined) f.responseBody = init.responseBody;
  return f;
}

export interface FakeLogger {
  log: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  verbose: ReturnType<typeof vi.fn>;
  all(): unknown[];
  contains(needle: string): boolean;
}

export function makeLogger(): FakeLogger {
  const log = vi.fn();
  const error = vi.fn();
  const warn = vi.fn();
  const debug = vi.fn();
  const verbose = vi.fn();
  const all = (): unknown[] =>
    [log, error, warn, debug, verbose].flatMap((fn) => fn.mock.calls.flat());
  return {
    log,
    error,
    warn,
    debug,
    verbose,
    all,
    contains: (needle: string) =>
      all().some((arg) => {
        try {
          return JSON.stringify(arg ?? null)?.includes(needle) ?? false;
        } catch {
          return String(arg).includes(needle);
        }
      }),
  };
}

export function attachLogger<T extends object>(service: T, logger: FakeLogger): FakeLogger {
  (service as unknown as { logger: unknown }).logger = logger;
  return logger;
}
