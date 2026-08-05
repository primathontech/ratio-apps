import { Injectable } from '@nestjs/common';
import type { UcHttpClient } from './order-push-worker.service';
import { UcCredentialsService } from './credentials.service';

/**
 * Outbound-call worker for `orders/cancelled` — mirrors
 * `UcOrderPushWorkerService`'s shape (credentials + generic http client +
 * shared clientId/securityKey config), but is invoked exclusively through
 * `UcSyncQueueService.attemptImmediate` (a 'cancel_push' job), never directly
 * from a webhook handler — see `UcOrderCancelledHandler` for why: it must
 * never hold the webhook-dispatch transaction open across this HTTP call.
 */
@Injectable()
export class UcCancelPushWorkerService {
  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly http: UcHttpClient,
    private readonly config: { clientId: string; securityKey: string; baseUrl: string },
  ) { }

  async push(
    merchantId: string,
    ratioOrderId: string,
    saleOrderCode: string,
    reason: string,
  ): Promise<{ alreadyDispatched: boolean }> {
    const ratioUsername = await this.credentials.getRatioUsername(merchantId);
    if (!ratioUsername) throw new Error(`no Unicommerce ratio_username on file for merchant ${merchantId}`);

    const result = await this.http.post(
      `${this.config.baseUrl}/uc/v1/order/cancel`,
      { saleOrderCode, cancellationReason: reason },
      { headers: { clientid: this.config.clientId, merchantid: ratioUsername, securitykey: this.config.securityKey } },
    );

    if (result.status === 'success') {
      return { alreadyDispatched: false };
    }
    // `status: 'failure'` is a normal 200 response body (TRD §2.10), not a
    // thrown transport error — "already dispatched" arrives this way, per
    // UC's docs, so it must be read off `result.message`, not caught as an
    // exception.
    if (result.message && /already dispatched/i.test(result.message)) {
      return { alreadyDispatched: true };
    }
    throw new Error(result.message ?? `Unicommerce cancel push reported status:failure for order ${ratioOrderId}`);
  }
}
