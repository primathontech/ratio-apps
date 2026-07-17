import type { Generated, Selectable } from 'kysely';

export interface ReturnPrimeMerchantsTable {
  id: Generated<string>;
  merchantId: string;
  domain: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  active: Generated<boolean>;
  returnExchangeEnabled: Generated<boolean>;
  installedAt: Generated<Date>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface RpDatabase {
  return_prime_merchants: ReturnPrimeMerchantsTable;
}

export type RpMerchantRow = Selectable<ReturnPrimeMerchantsTable>;
