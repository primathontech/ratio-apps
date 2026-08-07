import type { EventMap } from '@ratio-app/shared/schemas/event-map';
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

interface ClevertapConfigsTable {
  merchantId: string;
  accountId: Generated<string>;
  passcodeEnc: ColumnType<string | null, string | null | undefined, string | null>;
  region: Generated<string>;
  serverEventsEnabled: Generated<boolean>;
  debug: Generated<boolean>;
  catalogName: Generated<string>;
  catalogEmail: Generated<string>;
  catalogSyncEnabled: Generated<boolean>;
  clevertapEnabled: Generated<boolean>;
  disabledTopics: ColumnType<string[] | null, string[] | null | undefined, string[] | null>;
  chargedSource: Generated<string>;
  lastCatalogSyncAt: ColumnType<Date | null, Date | null | undefined, Date | null>;
  lastCatalogSyncStatus: ColumnType<string | null, string | null | undefined, string | null>;
  lastCatalogSyncCount: ColumnType<number | null, number | null | undefined, number | null>;
  lastCatalogSyncError: ColumnType<string | null, string | null | undefined, string | null>;
  events: ColumnType<EventMap, EventMap, EventMap>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type ClevertapForwardStatus = 'sent' | 'failed' | 'skipped';

interface ClevertapForwardedEventsTable {
  id: Generated<string>;
  merchantId: string;
  idempotencyKey: string;
  topic: string;
  clevertapEvent: string;
  status: ColumnType<ClevertapForwardStatus, ClevertapForwardStatus, ClevertapForwardStatus>;
  error: ColumnType<string | null, string | null | undefined, string | null>;
  sentAt: Generated<Date>;
}

export interface ClevertapDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  clevertap_configs: ClevertapConfigsTable;
  clevertap_forwarded_events: ClevertapForwardedEventsTable;
}

export type ClevertapMerchantRow = Selectable<BaseMerchantsTable>;
export type ClevertapConfigRow = Selectable<ClevertapConfigsTable>;
export type ClevertapForwardedEventRow = Selectable<ClevertapForwardedEventsTable>;
export type NewClevertapForwardedEvent = Insertable<ClevertapForwardedEventsTable>;
