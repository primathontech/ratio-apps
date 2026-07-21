import { Logger } from '@nestjs/common';
import { normalizePhone } from '../common/normalize-phone';

/**
 * Verifies a KwikPass `gk-access-token` by resolving the customer profile from
 * the GoKwik customer-profile API — the SAME endpoint the storefront's account
 * features use (`GET {base}/v1/storefront/customers/profile`, headers
 * `gk-access-token` + `gk-merchant-id`).
 *
 * This is the ONLY identity source for QR claims: a client-supplied phone is
 * never trusted. Any non-2xx / malformed / missing-phone outcome collapses to
 * null (⇒ `invalid_session` upstream) — no oracle about why.
 *
 * The token is treated as a credential: never logged, never persisted.
 */
export interface VerifiedGkCustomer {
  /** E.164-normalized verified phone. */
  phone: string;
  name?: string;
  email?: string;
}

const TIMEOUT_MS = 5_000;

export class GokwikIdentityClient {
  private readonly logger = new Logger(GokwikIdentityClient.name);
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async verify(gkAccessToken: string, merchantId: string): Promise<VerifiedGkCustomer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/storefront/customers/profile`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'gk-access-token': gkAccessToken,
          'gk-merchant-id': merchantId,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn({ msg: 'gokwik profile verify failed', status: res.status });
        return null;
      }
      const json = (await res.json()) as Record<string, unknown>;
      // Profile payloads vary by env — accept `{data: {...}}` or flat.
      const data = (json.data && typeof json.data === 'object' ? json.data : json) as Record<
        string,
        unknown
      >;
      const rawPhone =
        (typeof data.phone === 'string' && data.phone) ||
        (typeof data.phone_number === 'string' && data.phone_number) ||
        '';
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        this.logger.warn({ msg: 'gokwik profile has no usable phone' });
        return null;
      }
      return {
        phone,
        ...(typeof data.name === 'string' && data.name ? { name: data.name } : {}),
        ...(typeof data.email === 'string' && data.email ? { email: data.email } : {}),
      };
    } catch {
      this.logger.warn({ msg: 'gokwik profile verify errored' });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
