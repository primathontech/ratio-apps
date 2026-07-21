// The QR-claim API contract between the storefront widget and the loyalty
// backend. Browser-safe: public endpoints only, no secrets, no Zod — response
// types are imported TYPE-ONLY from `@ratio-app/shared`.
import type { LoyaltyClaimResponse, LoyaltyPublicConfig, LoyaltyQrStatus } from '@ratio-app/shared';

/** Config the {@link LoyaltyClient} is constructed with — public values only. */
export interface LoyaltyClientConfig {
  /** Backend base URL, e.g. `https://apps.example.com` (no trailing slash). */
  apiBase: string;
  /** Ratio merchant id (`?store=` on the loader script src). */
  merchantId: string;
}

/** Thrown when a loyalty endpoint responds with a non-2xx status. */
export class LoyaltyClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LoyaltyClientError';
  }
}

/** Per-request timeout — the claim UX fails soft rather than hanging. */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Typed `fetch` wrapper over the loyalty backend's **public** storefront
 * endpoints. Every request carries a {@link REQUEST_TIMEOUT_MS} abort timeout.
 */
export class LoyaltyClient {
  constructor(
    private readonly cfg: LoyaltyClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.cfg.apiBase}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) throw new LoyaltyClientError(res.status, await res.text());
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Redacted public program config: `{programName, enabled, version}`. */
  publicConfig(): Promise<LoyaltyPublicConfig> {
    return this.request<LoyaltyPublicConfig>(
      `/loyalty/sdk/config/${encodeURIComponent(this.cfg.merchantId)}`,
    );
  }

  /** Render data for a QR code: state, event name, points, program name. */
  qrStatus(code: string): Promise<LoyaltyQrStatus> {
    return this.request<LoyaltyQrStatus>(`/loyalty/qr/${encodeURIComponent(code)}/status`);
  }

  /**
   * Claim the QR reward. The body carries ONLY the KwikPass token — the
   * backend resolves the verified phone; a client phone is never sent.
   */
  claim(code: string, gkAccessToken: string): Promise<LoyaltyClaimResponse> {
    return this.request<LoyaltyClaimResponse>(`/loyalty/qr/${encodeURIComponent(code)}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gkAccessToken }),
    });
  }
}
