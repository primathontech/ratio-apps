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

export interface RpIdMappingsTable {
  id: Generated<string>;
  entityType: string;
  hashedId: string;
  realId: string;
  createdAt: Generated<Date>;
}

export interface RpDatabase {
  return_prime_merchants: ReturnPrimeMerchantsTable;
  rp_id_mappings: RpIdMappingsTable;
}

export type RpMerchantRow = Selectable<ReturnPrimeMerchantsTable>;
export type RpIdMappingRow = Selectable<RpIdMappingsTable>;
