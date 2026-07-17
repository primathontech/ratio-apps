import { Injectable, Logger } from '@nestjs/common';

/**
 * The KwikEngage shipping-events seam — the 7 shipping events are NOT in the
 * platform event catalog, so this app fires them itself on each unified-status
 * transition (deduped upstream by TrackingService via the
 * `(awb, unified_status)` unique constraint).
 *
 * Injected via `DELHIVERY_KWIKENGAGE`; tests provide a fake. Best-effort by
 * contract: event delivery must never fail a tracking sync, so errors are
 * logged and swallowed. When `DELHIVERY_KWIKENGAGE_URL` is unset the client
 * is a logged no-op (sandbox/dev).
 */
export interface KwikEngagePort {
  sendShippingEvent(merchantId: string, event: string, payload: Record<string, unknown>): Promise<void>;
}

@Injectable()
export class KwikEngageClient implements KwikEngagePort {
  private readonly logger = new Logger(KwikEngageClient.name);
  /** Test seam — override with a fake in unit tests. */
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args);

  async sendShippingEvent(
    merchantId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const url = process.env.DELHIVERY_KWIKENGAGE_URL;
    if (!url) {
      this.logger.debug({ msg: 'kwikengage url unset — event dropped', event, merchantId });
      return;
    }
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merchant_id: merchantId, event, ...payload }),
      });
      if (!res.ok) {
        this.logger.warn({ msg: 'kwikengage event non-ok', event, status: res.status });
      }
    } catch (err) {
      this.logger.warn({ msg: 'kwikengage event failed', event, err: `${err}` });
    }
  }
}
