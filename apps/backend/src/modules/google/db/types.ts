import type { Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

type ConnectionMethod = 'oauth' | 'manual';
type PixelStatus = 'active' | 'pending_api' | 'error' | 'disabled';
type GmcCondition = 'new' | 'refurbished' | 'used';
type GmcCategoryMode = 'auto' | 'default' | 'per_type';
type FeedItemStatus = 'SYNCED' | 'PENDING' | 'ERROR' | 'WARNING' | 'DELETED';
type SyncType = 'webhook' | 'auto' | 'reconcile' | 'initial' | 'manual';

/** One row per merchant — all three integrations + GMC sync settings. */
interface GoogleConfigsTable {
  merchantId: string;
  connectionMethod: Generated<ConnectionMethod>;
  googleAccountEmail: string | null;

  ga4Enabled: Generated<boolean>;
  ga4MeasurementId: string | null;
  ga4PixelId: string | null;
  ga4PixelStatus: Generated<PixelStatus>;

  adsEnabled: Generated<boolean>;
  adsConversionId: string | null;
  adsConversionLabel: string | null;
  adsPixelId: string | null;
  adsPixelStatus: Generated<PixelStatus>;
  enhancedConversionsEnabled: Generated<boolean>;

  gmcEnabled: Generated<boolean>;
  gmcMerchantId: string | null;
  /**
   * Merchant's verified storefront domain (bare host or full URL). Product
   * `link`s must share this domain or GMC flags "Mismatched online store URL".
   * NULL → fall back to the `GMC_STORE_URL` env default, then a placeholder.
   */
  gmcStoreUrl: string | null;
  /** Encrypted (CryptoService) GMC service-account JSON key. Never returned raw. */
  gmcServiceAccountKeyEnc: string | null;
  gmcTargetCountry: Generated<string>;
  gmcContentLanguage: Generated<string>;
  gmcCurrency: Generated<string>;
  gmcDefaultCondition: Generated<GmcCondition>;
  gmcBrandOverride: string | null;
  gmcGoogleProductCategory: string | null;
  gmcCategoryMode: Generated<GmcCategoryMode>;

  autoSyncEnabled: Generated<boolean>;
  hourlyReconcileEnabled: Generated<boolean>;
  syncVariantsEnabled: Generated<boolean>;
  includeOutOfStock: Generated<boolean>;
  freeListingsEnabled: Generated<boolean>;

  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Google OAuth tokens — distinct from Ratio's `oauth_tokens`. Tokens encrypted. */
interface GoogleCredentialsTable {
  merchantId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
  grantedScopes: string | null;
  needsReconnect: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** Per product/variant feed-item health for the feed-details screen. */
interface GoogleFeedItemsTable {
  id: Generated<number>;
  merchantId: string;
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  hasGtin: Generated<boolean>;
  issue: string | null;
  lastSyncedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/**
 * Append-only per-offer status-change log (audit history). Distinct from
 * google_feed_items (current state per offer): a row is inserted on every status
 * transition, so a failure that later recovers is preserved rather than overwritten.
 */
interface GoogleFeedEventsTable {
  id: Generated<number>;
  merchantId: string;
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  previousStatus: FeedItemStatus | null;
  issue: string | null;
  syncType: SyncType | null;
  createdAt: Generated<Date>;
}

/** Sync-history rows for the admin. */
interface GoogleSyncLogTable {
  id: Generated<number>;
  merchantId: string;
  syncType: SyncType;
  productsChecked: Generated<number>;
  productsUpdated: Generated<number>;
  productsErrored: Generated<number>;
  detail: string | null;
  createdAt: Generated<Date>;
}

export interface GoogleDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  google_configs: GoogleConfigsTable;
  google_credentials: GoogleCredentialsTable;
  google_feed_items: GoogleFeedItemsTable;
  google_feed_events: GoogleFeedEventsTable;
  google_sync_log: GoogleSyncLogTable;
}

export type GoogleMerchantRow = Selectable<BaseMerchantsTable>;
export type GoogleConfigRow = Selectable<GoogleConfigsTable>;
export type GoogleCredentialsRow = Selectable<GoogleCredentialsTable>;
export type GoogleFeedItemRow = Selectable<GoogleFeedItemsTable>;
export type GoogleFeedEventRow = Selectable<GoogleFeedEventsTable>;
export type GoogleSyncLogRow = Selectable<GoogleSyncLogTable>;
