import type { Generated } from 'kysely';

export interface BaseOauthTokensTable {
  merchantId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  scopes: string;
  updatedAt: Generated<Date>;
}

export interface DatabaseWithOauthTokens {
  oauth_tokens: BaseOauthTokensTable;
}
