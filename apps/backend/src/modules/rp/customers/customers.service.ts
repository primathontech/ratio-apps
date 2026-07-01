import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpRatioTokenProvider } from '../oauth/ratio-token.provider';
import { RpTransformerService } from '../transformer/transformer.service';

@Injectable()
export class RpCustomersService {
  constructor(
    private readonly tokenProvider: RpRatioTokenProvider,
    private readonly ratioClient: RpRatioClientService,
    private readonly transformer: RpTransformerService,
  ) {}

  async search(merchantId: string, query: string | undefined): Promise<unknown> {
    const token = await this.tokenProvider.getAccessToken(merchantId);
    const { email } = this.transformer.parseCustomerSearchQuery(query);
    if (!email) return { customers: [] };

    const raw = await this.ratioClient.searchCustomer(token, email) as Record<string, unknown>;
    const customer = (raw?.customer ?? raw?.data ?? raw) as Record<string, unknown> | null;
    if (!customer || !customer.id) return { customers: [] };

    return { customers: [this.transformer.shopifyCustomer(customer)] };
  }

  async create(merchantId: string, body: unknown): Promise<unknown> {
    const token = await this.tokenProvider.getAccessToken(merchantId);
    const raw = await this.ratioClient.createCustomer(token, body) as Record<string, unknown>;
    const customer = (raw?.customer ?? raw?.data ?? raw) as Record<string, unknown>;
    return { customer: this.transformer.shopifyCustomer(customer) };
  }
}
