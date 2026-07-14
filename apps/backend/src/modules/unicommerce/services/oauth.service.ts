import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import { UC_CRYPTO, UC_MOCK_UNICOMMERCE } from '../tokens';
import type { MockUnicommerceService } from '../mock/mock-unicommerce.service';
import { UcCredentialsService } from './credentials.service';

export interface UcOauthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class UcOauthService {
  private readonly logger = new Logger(UcOauthService.name);

  constructor(
    private readonly credentials: UcCredentialsService,
    @Inject(UC_CRYPTO) private readonly crypto: CryptoService,
    @Inject(UC_MOCK_UNICOMMERCE) private readonly ucMock: MockUnicommerceService,
  ) {}

  async obtainToken(merchantId: string): Promise<UcOauthSession> {
    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds) throw new Error('UC credentials not found for merchant');

    const response = await this.ucMock.exchangeToken(creds.tenantSlug, creds.username, creds.password);
    const session: UcOauthSession = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: new Date(Date.now() + response.expires_in * 1000),
    };

    await this.credentials.updateOauthTokens(merchantId, {
      accessTokenEnc: this.crypto.encrypt(session.accessToken),
      refreshTokenEnc: this.crypto.encrypt(session.refreshToken),
      expiresAt: session.expiresAt,
    });

    this.logger.log({ msg: 'UC OAuth token obtained', merchantId });
    return session;
  }

  async refreshToken(merchantId: string): Promise<UcOauthSession> {
    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds) throw new Error('UC credentials not found for merchant');
    if (!creds.oauthRefreshTokenEnc) return this.obtainToken(merchantId);

    const currentRefreshToken = this.crypto.decrypt(creds.oauthRefreshTokenEnc);
    const response = await this.ucMock.refreshToken(creds.tenantSlug, currentRefreshToken);
    const session: UcOauthSession = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: new Date(Date.now() + response.expires_in * 1000),
    };

    await this.credentials.updateOauthTokens(merchantId, {
      accessTokenEnc: this.crypto.encrypt(session.accessToken),
      refreshTokenEnc: this.crypto.encrypt(session.refreshToken),
      expiresAt: session.expiresAt,
    });

    this.logger.log({ msg: 'UC OAuth token refreshed', merchantId });
    return session;
  }

  async getValidToken(merchantId: string): Promise<string> {
    const creds = await this.credentials.getDecrypted(merchantId);
    if (!creds) throw new Error('UC credentials not found for merchant');

    if (creds.oauthAccessTokenEnc && creds.oauthExpiresAt) {
      const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
      if (creds.oauthExpiresAt.getTime() > fiveMinFromNow) {
        return this.crypto.decrypt(creds.oauthAccessTokenEnc);
      }
      if (creds.oauthExpiresAt.getTime() > Date.now()) {
        const session = await this.refreshToken(merchantId);
        return session.accessToken;
      }
    }

    const session = await this.obtainToken(merchantId);
    return session.accessToken;
  }
}
