import type { LoyaltyConditionNode } from '@ratio-app/shared/schemas/loyalty-rules';
import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

/**
 * mysql2 returns DECIMAL columns as strings (exact-precision safety); writes
 * accept number | string. Read sites coerce with `Number()`.
 * NOTE: Kysely's `Generated<>` doesn't unwrap a nested `ColumnType` alias, so
 * DB-defaulted decimal/bigint columns use the explicit *WithDefault aliases
 * (insert-optional via `undefined` in the insert type).
 */
type DecimalColumn = ColumnType<string, number | string, number | string>;
type DecimalColumnWithDefault = ColumnType<string, number | string | undefined, number | string>;
/** BIGINT columns: mysql2 returns number (within JS safe range for our sums). */
type BigIntColumnWithDefault = ColumnType<number, number | string | undefined, number | string>;

export interface LoyaltyConfigsTable {
  merchantId: string;
  programName: Generated<string>;
  baseEarnRate: DecimalColumnWithDefault;
  coinValueInr: DecimalColumnWithDefault;
  storefrontBaseUrl: string | null;
  exportEmail: string | null;
  claimSigningSecret: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface LoyaltyCustomersTable {
  merchantId: string;
  phone: string;
  name: string | null;
  email: string | null;
  pointsBalance: Generated<number>;
  lifetimeEarned: Generated<number>;
  lifetimeRedeemed: Generated<number>;
  lifetimeExpired: Generated<number>;
  lifetimeAdjusted: Generated<number>;
  lifetimeSpend: DecimalColumnWithDefault;
  lifetimeOrders: Generated<number>;
  lastOrderAt: Date | null;
  firstSeenSource: Generated<'order' | 'bulk' | 'qr' | 'manual'>;
  balanceSyncedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type LoyaltyBulkOperationType = 'credit' | 'debit';
export type LoyaltyBulkOperationStatus =
  | 'validating'
  | 'awaiting_confirm'
  | 'processing'
  | 'done'
  | 'failed';

export interface LoyaltyBulkOperationsTable {
  id: string;
  merchantId: string;
  type: LoyaltyBulkOperationType;
  status: Generated<LoyaltyBulkOperationStatus>;
  fileName: string | null;
  totalRows: Generated<number>;
  validRows: Generated<number>;
  invalidRows: Generated<number>;
  processedRows: Generated<number>;
  successCount: Generated<number>;
  failureCount: Generated<number>;
  totalPoints: BigIntColumnWithDefault;
  createdBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type LoyaltyBulkRowStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface LoyaltyBulkOperationRowsTable {
  id: Generated<number>;
  operationId: string;
  rowNumber: number;
  phone: string;
  points: number;
  reason: string | null;
  status: Generated<LoyaltyBulkRowStatus>;
  errorReason: string | null;
  coreTransactionId: string | null;
  processedAt: Date | null;
}

export type LoyaltyRuleType = 'MULTIPLIER' | 'BONUS';
export type LoyaltyRuleTargetType = 'SEGMENT' | 'CUSTOMER_LIST';

export interface LoyaltyRulesTable {
  id: string;
  merchantId: string;
  name: string;
  ruleType: LoyaltyRuleType;
  value: DecimalColumn;
  targetType: LoyaltyRuleTargetType;
  conditions: ColumnType<LoyaltyConditionNode | null, string | null, string | null>;
  startsAt: Date;
  endsAt: Date | null;
  active: Generated<boolean>;
  priority: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface LoyaltyRuleCustomersTable {
  ruleId: string;
  phone: string;
  addedAt: Generated<Date>;
}

export interface LoyaltyRuleApplicationsTable {
  id: Generated<number>;
  merchantId: string;
  ruleId: string;
  orderId: string;
  phone: string;
  basePoints: number;
  extraPoints: number;
  appliedAt: Generated<Date>;
}

export type LoyaltyQrStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED';

export interface LoyaltyQrCodesTable {
  id: string;
  merchantId: string;
  code: string;
  eventName: string;
  pointsPerScan: number;
  maxScans: Generated<number>;
  startsAt: Date;
  expiresAt: Date;
  claimMessage: string | null;
  status: Generated<LoyaltyQrStatus>;
  scanCount: Generated<number>;
  newPhoneCount: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface LoyaltyQrScansTable {
  id: Generated<number>;
  qrCodeId: string;
  merchantId: string;
  phone: string;
  isNewPhone: Generated<boolean>;
  coreTransactionId: string | null;
  convertedOrderId: string | null;
  convertedAt: Date | null;
  scannedAt: Generated<Date>;
}

export type LoyaltyExportStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface LoyaltyExportsTable {
  id: string;
  merchantId: string;
  filters: ColumnType<Record<string, unknown>, string, string>;
  status: Generated<LoyaltyExportStatus>;
  rowCount: number | null;
  s3Key: string | null;
  email: string | null;
  emailedAt: Date | null;
  createdBy: string | null;
  completedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface LoyaltyDailyStatsTable {
  merchantId: string;
  statDate: ColumnType<Date | string, string, string>;
  pointsIssued: BigIntColumnWithDefault;
  pointsRedeemed: BigIntColumnWithDefault;
  pointsExpired: BigIntColumnWithDefault;
  bulkCredited: BigIntColumnWithDefault;
  bulkDebited: BigIntColumnWithDefault;
  qrPoints: BigIntColumnWithDefault;
  ruleExtraPoints: BigIntColumnWithDefault;
  customersWithBalance: Generated<number>;
  outstandingPoints: BigIntColumnWithDefault;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface LoyaltyDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  loyalty_configs: LoyaltyConfigsTable;
  loyalty_customers: LoyaltyCustomersTable;
  loyalty_bulk_operations: LoyaltyBulkOperationsTable;
  loyalty_bulk_operation_rows: LoyaltyBulkOperationRowsTable;
  loyalty_rules: LoyaltyRulesTable;
  loyalty_rule_customers: LoyaltyRuleCustomersTable;
  loyalty_rule_applications: LoyaltyRuleApplicationsTable;
  loyalty_qr_codes: LoyaltyQrCodesTable;
  loyalty_qr_scans: LoyaltyQrScansTable;
  loyalty_exports: LoyaltyExportsTable;
  loyalty_daily_stats: LoyaltyDailyStatsTable;
}

export type LoyaltyMerchantRow = Selectable<BaseMerchantsTable>;
export type LoyaltyConfigRow = Selectable<LoyaltyConfigsTable>;
export type LoyaltyCustomerRow = Selectable<LoyaltyCustomersTable>;
export type LoyaltyBulkOperationRow = Selectable<LoyaltyBulkOperationsTable>;
export type LoyaltyBulkOpRowRow = Selectable<LoyaltyBulkOperationRowsTable>;
export type LoyaltyRuleRow = Selectable<LoyaltyRulesTable>;
export type LoyaltyQrCodeRow = Selectable<LoyaltyQrCodesTable>;
export type LoyaltyQrScanRow = Selectable<LoyaltyQrScansTable>;
export type LoyaltyExportRow = Selectable<LoyaltyExportsTable>;
export type LoyaltyDailyStatsRow = Selectable<LoyaltyDailyStatsTable>;
