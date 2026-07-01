import { Injectable } from '@nestjs/common';
import { RpRatioClientService } from '../ratio-client/ratio-client.service';
import { RpRatioTokenProvider } from '../oauth/ratio-token.provider';

@Injectable()
export class RpDiscountsService {
  constructor(
    private readonly tokenProvider: RpRatioTokenProvider,
    private readonly ratioClient: RpRatioClientService,
  ) {}

  async createDiscount(merchantId: string, body: unknown): Promise<unknown> {
    const token = await this.tokenProvider.getAccessToken(merchantId);
    return this.ratioClient.createDiscount(token, body);
  }
}
