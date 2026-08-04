import { Injectable } from '@nestjs/common';
import { UcCredentialsService } from './credentials.service';

// The real POST uc/v1/order request body (TRD §2.9) — everything UC's
// contract actually documents, no invented wrapper.
export interface UcOrderPayload {
  id: string;
  displayOrderNumber?: string;
  orderDate: string;
  orderStatus: 'CREATED';
  sla: string;
  priority: number;
  paymentType: 'COD' | 'PREPAID';
  taxExempted: boolean;
  cFormProvided: boolean;
  thirdPartyShipping: boolean;
  orderPrice: { currency: string; totalDiscount: number; totalShippingCharges: number };
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  orderItems: Record<string, unknown>[];
}

export interface PushJob {
  merchantId: string;
  ratioOrderId: string;
  order: UcOrderPayload;
}

// UC's real response shape, confirmed directly against postorders.html —
// `{ status: "success"|"failure", message, data: null }`. There is no
// `successful` boolean and no `saleOrderCode` (or any order-identifying
// field) anywhere in it — see Open Item #5: we use our own `id` as the
// surrogate saleOrderCode at the call site (UcSyncQueueService), not
// anything read off this response.
export interface UcApiResponse {
  status: 'success' | 'failure';
  message?: string;
  data: null;
}

export interface UcHttpClient {
  post(url: string, body: unknown, opts: { headers: Record<string, string> }): Promise<UcApiResponse>;
}

@Injectable()
export class UcOrderPushWorkerService {
  constructor(
    private readonly credentials: UcCredentialsService,
    private readonly http: UcHttpClient,
    private readonly config: { clientId: string; securityKey: string; baseUrl: string },
  ) {}

  async push(job: PushJob): Promise<UcApiResponse> {
    const ucUsername = await this.credentials.getUcUsername(job.merchantId);
    if (!ucUsername) {
      throw new Error(`no Unicommerce username on file for merchant ${job.merchantId}`);
    }

    const result = await this.http.post(`${this.config.baseUrl}/uc/v1/order`, job.order, {
      headers: {
        clientid: this.config.clientId,
        merchantid: ucUsername,
        securitykey: this.config.securityKey,
      },
    });

    // `status: "failure"` is Unicommerce's application-level failure signal —
    // the HTTP call itself didn't throw, but the order was rejected. Throwing
    // here (rather than returning the result as-is) is what routes this into
    // `UcSyncQueueService.attemptImmediate`'s existing recoverable/
    // non-recoverable classification, exactly like a transport-level failure
    // does today. We surface Unicommerce's own `message` when present so
    // `isNonRecoverable()`'s regex (sku/facility/validation) can classify it
    // the same way it already classifies thrown HTTP errors; when Unicommerce
    // doesn't give us a message, we default to a generic error that the
    // regex won't match — i.e. conservatively RECOVERABLE (retried), rather
    // than risking a transient/ambiguous failure going straight to the DLQ.
    if (result.status !== 'success') {
      throw new Error(
        result.message ?? `Unicommerce order push reported status:failure for order ${job.ratioOrderId}`,
      );
    }

    return result;
  }
}
