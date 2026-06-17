import type { EventMap } from '@ratio-app/shared/schemas/event-map';
import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

/**
 * MoEngage's per-merchant config row. No `app` column — table lives in the
 * MoEngage-only database (`moengage_app`), so all rows are implicitly scoped
 * to this module.
 *
 *   - `appId`      MoEngage workspace App ID (uppercase alphanumeric + `_`)
 *   - `dataCenter` `DC_1` … `DC_5` (validated against MOENGAGE_DATA_CENTERS)
 *   - `swPath`     Same-origin service-worker path (empty string when unset)
 *   - `events`     JSON event-map (Title-Case names for MoEngage)
 */
interface MoengageConfigsTable {
  merchantId: string;
  appId: string;
  dataCenter: string;
  debug: Generated<boolean>;
  swPath: Generated<string>;
  events: ColumnType<EventMap, EventMap, EventMap>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface MoengageDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  moengage_configs: MoengageConfigsTable;
}

export type MoengageMerchantRow = Selectable<BaseMerchantsTable>;
export type MoengageConfigRow = Selectable<MoengageConfigsTable>;
