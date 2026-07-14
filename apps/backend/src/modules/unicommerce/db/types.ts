import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

export interface UcCredentialsTable {
  merchantId: string;
  tenantSlug: string;
  usernameEnc: string;
  passwordEnc: string;
  facilityCode: string;
  active: Generated<boolean>;
  killSwitch: Generated<boolean>;
  oauthAccessTokenEnc: string | null;
  oauthRefreshTokenEnc: string | null;
  oauthExpiresAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UcSyncQueueTable {
  id: Generated<string>;
  merchantId: string;
  orderId: string;
  syncType: string;
  status: string;
  retryCount: Generated<number>;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UcSyncLogTable {
  id: Generated<string>;
  merchantId: string;
  syncType: string;
  status: string;
  itemCount: Generated<number>;
  errorCount: Generated<number>;
  lastRunAt: Generated<Date>;
  createdAt: Generated<Date>;
}

export interface UcCircuitBreakerTable {
  merchantId: string;
  tripped: Generated<boolean>;
  failureCount: Generated<number>;
  lastFailureAt: Date | null;
  trippedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UnicommerceDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  uc_credentials: UcCredentialsTable;
  uc_sync_queue: UcSyncQueueTable;
  uc_sync_log: UcSyncLogTable;
  uc_circuit_breaker: UcCircuitBreakerTable;
}

export type UcCredentialsRow = Selectable<UcCredentialsTable>;
export type UcSyncQueueRow = Selectable<UcSyncQueueTable>;
export type UcSyncLogRow = Selectable<UcSyncLogTable>;
export type UcCircuitBreakerRow = Selectable<UcCircuitBreakerTable>;
