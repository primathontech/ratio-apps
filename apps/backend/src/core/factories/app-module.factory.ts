import type { Provider, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { CryptoService } from '../crypto/crypto.service';
import type { KyselyClient } from '../db/kysely-factory';
import type { DatabaseWithMerchants } from '../merchants/merchant.types';
import { MerchantsService } from '../merchants/merchants.service';
import type { AppBootstrap } from '../oauth/app-bootstrap.token';
import { OAuthService } from '../oauth/oauth.service';
import type { DatabaseWithOauthTokens } from '../oauth/oauth-tokens.types';
import { RatioClient } from '../ratio-client/ratio.client';
import type { DatabaseWithWebhookLog } from '../webhooks/webhook-log.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import type { WebhookHandler } from '../webhooks/webhooks.types';

/**
 * Per-app configuration for the shared provider factory.
 *
 * `slug` drives `RATIO_<SLUG_UPPER>_*` env-key lookups; `dbToken` is the
 * module-private symbol exposing the app's Kysely client; `bootstrapClass`
 * and `handlerClass` are the app-specific @Injectable() classes wired into
 * the OAuth install / webhook dispatch flow respectively.
 */
export interface AppModuleParts<
  DB extends DatabaseWithMerchants & DatabaseWithOauthTokens & DatabaseWithWebhookLog,
> {
  /** e.g. '_template'. Uppercased to derive RATIO_<APP>_* env keys. */
  slug: string;
  dbToken: symbol;
  bootstrapClass: Type<AppBootstrap<DB>>;
  /**
   * Single webhook-handler class (legacy single-topic form, e.g. `_template`'s
   * uninstall handler). Provide this OR `handlerClasses` — at least one handler
   * is required.
   */
  handlerClass?: Type<WebhookHandler>;
  /**
   * Multiple webhook-handler classes (one per subscribed topic). Used by apps
   * that subscribe to several topics (e.g. `google`: uninstall + products.*).
   */
  handlerClasses?: ReadonlyArray<Type<WebhookHandler>>;
}

/**
 * DI symbol bundle. Each module owns its own set of these.
 */
export interface AppModuleTokens {
  CRYPTO: symbol;
  RATIO: symbol;
  MERCHANTS: symbol;
  OAUTH: symbol;
  WEBHOOKS: symbol;
}

/**
 * Build the shared per-module provider list — Crypto / Ratio / Merchants /
 * OAuth / Webhooks — that every concrete `<App>Module` (e.g. `GoogleModule`,
 * and the `_template` golden source) needs to register. Each provider remains
 * module-scoped because the symbols passed
 * in (`tokens.*`) are owned by the calling module.
 *
 * The factory only handles the SHARED wiring. App-specific controllers,
 * services (config / sdk), bootstrap class, handler class, and guards are
 * still registered directly by each `<App>Module`.
 */
export function createAppProviders<
  DB extends DatabaseWithMerchants & DatabaseWithOauthTokens & DatabaseWithWebhookLog,
>(parts: AppModuleParts<DB>, tokens: AppModuleTokens): Provider[] {
  const upper = parts.slug.toUpperCase();
  return [
    {
      provide: tokens.CRYPTO,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CryptoService =>
        new CryptoService(
          Buffer.from(
            config.get(`RATIO_${upper}_DATA_ENCRYPTION_KEY` as never, {
              infer: true,
            }) as string,
            'base64',
          ),
        ),
    },
    {
      provide: tokens.RATIO,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): RatioClient =>
        new RatioClient(config.get('RATIO_API_BASE_URL', { infer: true }) as string),
    },
    {
      provide: tokens.MERCHANTS,
      inject: [parts.dbToken],
      useFactory: (handle: KyselyClient<DB>): MerchantsService<DB> =>
        new MerchantsService<DB>(handle.db),
    },
    {
      provide: tokens.OAUTH,
      inject: [parts.dbToken, tokens.CRYPTO, tokens.RATIO, ConfigService, parts.bootstrapClass],
      useFactory: (
        handle: KyselyClient<DB>,
        crypto: CryptoService,
        ratio: RatioClient,
        config: ConfigService<Env, true>,
        bootstrap: AppBootstrap<DB>,
      ): OAuthService<DB> =>
        new OAuthService<DB>({
          db: handle.db,
          crypto,
          ratio,
          creds: {
            clientId: config.get(`RATIO_${upper}_CLIENT_ID` as never, {
              infer: true,
            }) as string,
            clientSecret: config.get(`RATIO_${upper}_CLIENT_SECRET` as never, {
              infer: true,
            }) as string,
            callbackUrl: config.get(`RATIO_${upper}_CALLBACK_URL` as never, {
              infer: true,
            }) as string,
          },
          bootstrap,
        }),
    },
    webhooksProvider<DB>(parts, tokens),
  ];
}

/**
 * Build the WEBHOOKS provider, injecting every registered handler class so the
 * `WebhooksService` can route by topic. Supports both the legacy single
 * `handlerClass` and the multi `handlerClasses[]` form; the injected handler
 * instances (after `parts.dbToken`) are forwarded to the service as `handlers`.
 */
function webhooksProvider<
  DB extends DatabaseWithMerchants & DatabaseWithOauthTokens & DatabaseWithWebhookLog,
>(parts: AppModuleParts<DB>, tokens: AppModuleTokens): Provider {
  const handlerClasses: ReadonlyArray<Type<WebhookHandler>> =
    parts.handlerClasses ?? (parts.handlerClass ? [parts.handlerClass] : []);
  if (handlerClasses.length === 0) {
    throw new Error(
      `createAppProviders('${parts.slug}'): at least one handlerClass/handlerClasses is required`,
    );
  }
  return {
    provide: tokens.WEBHOOKS,
    inject: [parts.dbToken, ...handlerClasses],
    useFactory: (handle: KyselyClient<DB>, ...handlers: WebhookHandler[]): WebhooksService<DB> =>
      new WebhooksService<DB>({
        db: handle.db,
        handlers,
      }),
  };
}
