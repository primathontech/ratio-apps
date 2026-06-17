import type { EventMap } from '@ratio-app/shared/schemas/event-map';
import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

interface PosthogConfigsTable {
  merchantId: string;
  apiKey: string;
  host: string;
  debug: Generated<boolean>;
  events: ColumnType<EventMap, EventMap, EventMap>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface PosthogDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  posthog_configs: PosthogConfigsTable;
}

export type PosthogMerchantRow = Selectable<BaseMerchantsTable>;
export type PosthogConfigRow = Selectable<PosthogConfigsTable>;
