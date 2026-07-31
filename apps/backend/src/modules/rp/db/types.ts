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
  // True only after RP's os-install has genuinely confirmed this merchant (a real
  // 2xx response) — NOT inferred from `domain` having been updated, which happens
  // regardless of whether the RP-side call that follows succeeds or fails.
  rpRegistered: Generated<boolean>;
  // JSON-stringified `{ plan, pricing_plan_details }` snapshot RP took of this
  // merchant's pre-link plan (see the 0005 migration). Null for a single-platform
  // merchant, or once a real uninstall has purged it — see handleAppUninstalled.
  previousPlan: string | null;
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
