// The QR-claim API contract between the storefront widget and the merchant
// STOREFRONT's own same-origin BFF routes. Browser-safe: public endpoints
// only, no secrets, no Zod — response types are imported TYPE-ONLY from
// `@ratio-app/shared`. The storefront BFF resolves identity (KwikPass token
// → verified phone) and forwards a signed request to our backend; this
// client never talks to our backend or ngrok directly.
import type { LoyaltyClaimResponse, LoyaltyQrStatus } from '@ratio-app/shared';

/** Config the {@link LoyaltyClient} is constructed with — public values only. */
export interface LoyaltyClientConfig {
  /** Same-origin base, i.e. `window.location.origin` (no trailing slash). */
  baseUrl: string;
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
 * Typed `fetch` wrapper over the storefront's **same-origin** loyalty BFF
 * routes (`/api/loyalty/*`). Every request carries a {@link REQUEST_TIMEOUT_MS}
 * abort timeout.
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
      const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (!res.ok) throw new LoyaltyClientError(res.status, await res.text());
      // The storefront BFF returns clean, non-enveloped JSON — no unwrap.
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Render data for a QR code: state, event name, points, program name. */
  qrStatus(qr: string): Promise<LoyaltyQrStatus> {
    return this.request<LoyaltyQrStatus>(`/api/loyalty/status?qr=${encodeURIComponent(qr)}`);
  }

  /**
   * Claim the QR reward. The body carries the QR code and the KwikPass
   * token — the storefront BFF resolves the verified phone and signs the
   * request to our backend; a phone is never sent from the browser.
   */
  claim(qr: string, gkAccessToken: string): Promise<LoyaltyClaimResponse> {
    return this.request<LoyaltyClaimResponse>('/api/loyalty/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qr, gkAccessToken }),
    });
  }
}
