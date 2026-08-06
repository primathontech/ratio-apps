import type { Generated } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

export type OauthTokensTable = BaseOauthTokensTable;
export type WebhookLogTable = BaseWebhookLogTable;

export interface UcCredentialsTable {
  merchantId: string;
  ratioUsername: string;
  passwordEnc: string;
  ucUsername: string;
  storeDomain: string | null;
  status: 'active' | 'paused' | 'uninstalled';
  lastInboundCallAt: Date | null;
  lastStatusNotificationAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UcAccessTokensTable {
  tokenHash: string;
  merchantId: string;
  issuedAt: Generated<Date>;
  expiresAt: Date;
}

export interface UcSkuCacheTable {
  merchantId: string;
  sku: string;
  ratioVariantId: string;
  ratioProductId: string;
  updatedAt: Generated<Date>;
}

export interface UcOrderItemMapTable {
  orderItemId: string;
  merchantId: string;
  ratioOrderId: string;
  ratioLineItemId: string;
  orderedQuantity: number;
  remainingQuantity: number;
  lastStatus: string | null;
  lastStatusUpdatedAt: Date | null;
  saleOrderCode: string | null;
  source: 'ratio_originated' | 'uc_originated';
  createdAt: Generated<Date>;
}

export interface UcVariantInventoryTable {
  merchantId: string;
  variantId: string;
  facilityCode: string;
  sku: string;
  inventory: number;
  updatedAt: Generated<Date>;
}

export interface UcSyncJobsTable {
  id: Generated<string>;
  merchantId: string;
  type: 'order_push' | 'cancel_push';
  ratioOrderId: string;
  payload: unknown;
  status: 'PENDING' | 'RETRYING' | 'NEEDS_MANUAL' | 'DONE' | 'IN_PROGRESS';
  attemptCount: Generated<number>;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Generated<Date>;
  saleOrderCode: string | null;
}

export interface UcDlqTable {
  id: Generated<string>;
  merchantId: string;
  originalJobId: string;
  payload: unknown;
  attempts: number;
  lastError: string;
  createdAt: Generated<Date>;
}

export interface UcEventLogsTable {
  id: Generated<string>;
  merchantId: string;
  direction: 'inbound' | 'outbound';
  flow:
    | 'auth'
    | 'order_push'
    | 'inventory'
    | 'dispatch'
    | 'cancel'
    | 'status'
    | 'catalog'
    | 'webhook';
  reference: string;
  result: 'success' | 'failed' | 'partial';
  payload: unknown;
  response: unknown | null;
  createdAt: Generated<Date>;
  jobId: string | null;
}

export interface UcReconciliationJobsTable {
  id: Generated<string>;
  merchantId: string;
  requestedBy: 'system' | 'manual';
  timeRangeStart: Date;
  timeRangeEnd: Date;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  ordersCheckedCount: number;
  ordersPushedCount: number;
  ordersAlreadySyncedCount: number;
  ordersFailedCount: number;
  startedAt: Generated<Date>;
  completedAt: Date | null;
}

export interface UcAlertsTable {
  id: Generated<string>;
  merchantId: string;
  type: 'INBOUND_SILENCE' | 'STALE_ORDER';
  reference: string | null;
  detectedAt: Generated<Date>;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

export interface UcConfigsTable {
  merchantId: string;
  productSyncEnabled: Generated<boolean>;
  inventorySyncEnabled: Generated<boolean>;
  orderPushEnabled: Generated<boolean>;
  dispatchStatusSyncEnabled: Generated<boolean>;
  cancelSyncEnabled: Generated<boolean>;
  notificationsEnabled: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface UnicommerceDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: OauthTokensTable;
  webhook_log: WebhookLogTable;
  ucCredentials: UcCredentialsTable;
  ucAccessTokens: UcAccessTokensTable;
  ucSkuCache: UcSkuCacheTable;
  ucOrderItemMap: UcOrderItemMapTable;
  ucVariantInventory: UcVariantInventoryTable;
  ucSyncJobs: UcSyncJobsTable;
  ucDlq: UcDlqTable;
  ucEventLogs: UcEventLogsTable;
  ucReconciliationJobs: UcReconciliationJobsTable;
  ucAlerts: UcAlertsTable;
  ucConfigs: UcConfigsTable;
}
