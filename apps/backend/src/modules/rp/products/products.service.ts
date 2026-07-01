import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpTransformerService } from '../transformer/transformer.service';

@Injectable()
export class RpProductsService {
  constructor(
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
  ) {}

  async getProduct(merchantId: string, domain: string, productId: string): Promise<unknown> {
    const raw = await this.ratioClient.getProduct(merchantId, domain, productId) as Record<string, unknown>;
    const product = (raw?.product ?? raw?.data ?? raw) as Record<string, unknown>;
    return { product: this.transformer.shopifyProduct(product) };
  }
}
