import { Injectable } from '@nestjs/common';
import { RpRatioTokenProvider } from '../oauth/ratio-token.provider';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpTransformerService } from '../transformer/transformer.service';

@Injectable()
export class RpRefundsService {
  constructor(
    private readonly tokenProvider: RpRatioTokenProvider,
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
  ) {}

  async calculateRefund(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const mapped = this.transformer.mapRefundRequest(body as Record<string, unknown>);
    const token = await this.tokenProvider.getAccessToken(merchantId);
    const raw = (await this.ratioClient.calculateRefund(token, merchantId, orderId, mapped)) as Record<string, unknown>;
    // Ratio returns its own calculate shape (lineItems/totalRefundable, paise). RP's refund flow
    // reads the Shopify shape (transactions[].maximum_refundable, refund_line_items, currency),
    // so transform it here — otherwise RP does `.transactions.map()` on undefined and 500s.
    return this.transformer.shopifyRefundCalculate(raw, orderId);
  }

  async createRefund(merchantId: string, orderId: string, body: unknown): Promise<unknown> {
    const mapped = this.transformer.mapRefundRequest(body as Record<string, unknown>);
    const token = await this.tokenProvider.getAccessToken(merchantId);
    const raw = await this.ratioClient.createRefund(token, merchantId, orderId, mapped) as Record<string, unknown>;
    return { refund: this.transformer.shopifyRefund(raw, orderId) };
  }

  async getRefunds(merchantId: string, orderId: string): Promise<unknown> {
    const token = await this.tokenProvider.getAccessToken(merchantId);
    const raw = await this.ratioClient.getRefunds(token, merchantId, orderId);
    return this.transformer.shopifyRefundList(raw, orderId);
  }
}
