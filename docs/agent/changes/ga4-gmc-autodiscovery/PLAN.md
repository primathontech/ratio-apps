# GA4 + GMC auto-discovery after OAuth connect — implementation plan
**Goal:** After a merchant connects their Google account, auto-fill GA4 Measurement ID(s) and GMC Merchant ID(s) on the config form by reading them from Google with the already-granted OAuth scopes.
**Spec:** docs/agent/changes/ga4-gmc-autodiscovery/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

No DB migration, no new env, no commits (no `.git` — end tasks at `pnpm verify`).
Backend tests live in `apps/backend/test/unit/apps/google/`; shared tests are
colocated. Token values are never logged.

---

### Task 1: Shared discovery contract
**Files:** Modify `packages/shared/src/schemas/google-config.ts`; Test `packages/shared/src/schemas/google-config.test.ts`
- [ ] Write the failing test (append to the existing file):
```ts
import {
  googleDiscoverResponseSchema,
  type GoogleDiscoverResponse,
} from './google-config';

describe('googleDiscoverResponseSchema', () => {
  it('parses a full discovery payload', () => {
    const value: GoogleDiscoverResponse = {
      ga4: { streams: [{ measurementId: 'G-ABC123', displayName: 'Web', property: 'properties/1' }] },
      gmc: { accounts: [{ merchantId: '1234567' }] },
    };
    expect(googleDiscoverResponseSchema.parse(value)).toEqual(value);
  });

  it('allows empty lists with an error reason', () => {
    const value = {
      ga4: { streams: [], error: 'oauth required' },
      gmc: { accounts: [], error: 'oauth required' },
    };
    expect(googleDiscoverResponseSchema.parse(value)).toEqual(value);
  });
});
```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/shared test`
- [ ] Minimal implementation (append near the other exports in `google-config.ts`):
```ts
export const ga4StreamSchema = z.object({
  measurementId: z.string(),
  displayName: z.string().optional(),
  property: z.string().optional(),
});
export const gmcAccountSchema = z.object({
  merchantId: z.string(),
  name: z.string().optional(),
});
export const googleDiscoverResponseSchema = z.object({
  ga4: z.object({ streams: z.array(ga4StreamSchema), error: z.string().optional() }),
  gmc: z.object({ accounts: z.array(gmcAccountSchema), error: z.string().optional() }),
});
export type GoogleDiscoverResponse = z.infer<typeof googleDiscoverResponseSchema>;
```
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/shared test`
- [ ] Run `pnpm verify`

---

### Task 2: GA4 Admin API client
**Files:** Create `apps/backend/src/modules/google/ga4/ga4-admin.client.ts`; Test `apps/backend/test/unit/apps/google/ga4-admin.client.test.ts`
- [ ] Write the failing test:
```ts
import { describe, expect, it, vi } from 'vitest';
import { Ga4AdminClient } from '../../../../src/modules/google/ga4/ga4-admin.client';

const BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const TOKEN = 'ya29.ga4-token';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('Ga4AdminClient.listWebMeasurementIds', () => {
  it('collects WEB_DATA_STREAM measurement ids across properties with a Bearer token', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      expect(auth).toBe(`Bearer ${TOKEN}`);
      if (u.endsWith('/accountSummaries')) {
        return Promise.resolve(json({
          accountSummaries: [{ propertySummaries: [{ property: 'properties/11', displayName: 'Store' }] }],
        }));
      }
      return Promise.resolve(json({
        dataStreams: [
          { type: 'WEB_DATA_STREAM', displayName: 'Web', webStreamData: { measurementId: 'G-ABC123' } },
          { type: 'IOS_APP_DATA_STREAM', webStreamData: {} },
        ],
      }));
    }) as unknown as typeof fetch;

    const client = new Ga4AdminClient({ getAccessToken: async () => TOKEN, fetchImpl });
    const streams = await client.listWebMeasurementIds();

    expect(streams).toEqual([{ measurementId: 'G-ABC123', displayName: 'Web', property: 'properties/11' }]);
    expect(calls[0]).toBe(`${BASE}/accountSummaries`);
    expect(calls[1]).toBe(`${BASE}/properties/11/dataStreams`);
  });

  it('throws Ga4AdminError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ error: { message: 'denied' } }, 403))) as unknown as typeof fetch;
    const client = new Ga4AdminClient({ getAccessToken: async () => TOKEN, fetchImpl });
    await expect(client.listWebMeasurementIds()).rejects.toThrow('denied');
  });
});
```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/backend test ga4-admin.client`
- [ ] Minimal implementation:
```ts
/**
 * Thin, typed client for the Google Analytics Admin API (v1beta). Mirrors
 * `ContentApiClient`: injected `fetchImpl`, Bearer token from `getAccessToken`,
 * never logs tokens. Reads the merchant's web-stream Measurement IDs.
 */
export interface Ga4Stream {
  measurementId: string;
  displayName?: string;
  property?: string;
}

export interface Ga4AdminClientOptions {
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://analyticsadmin.googleapis.com/v1beta';
const MAX_PROPERTIES = 25;

interface GoogleErrorBody {
  error?: { message?: string };
}

export class Ga4AdminError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'Ga4AdminError';
    this.status = status;
  }
}

export class Ga4AdminClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Ga4AdminClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** List web-stream Measurement IDs across the account's properties. */
  async listWebMeasurementIds(): Promise<Ga4Stream[]> {
    const summaries = await this.request<{
      accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string; displayName?: string }> }>;
    }>(`${this.baseUrl}/accountSummaries`);

    const properties = (summaries.accountSummaries ?? [])
      .flatMap((a) => a.propertySummaries ?? [])
      .filter((p): p is { property: string; displayName?: string } => typeof p.property === 'string')
      .slice(0, MAX_PROPERTIES);

    const streams: Ga4Stream[] = [];
    for (const p of properties) {
      const res = await this.request<{
        dataStreams?: Array<{ type?: string; displayName?: string; webStreamData?: { measurementId?: string } }>;
      }>(`${this.baseUrl}/${p.property}/dataStreams`);
      for (const ds of res.dataStreams ?? []) {
        const measurementId = ds.webStreamData?.measurementId;
        if (ds.type === 'WEB_DATA_STREAM' && measurementId) {
          streams.push({
            measurementId,
            ...(ds.displayName ?? p.displayName ? { displayName: ds.displayName ?? p.displayName } : {}),
            property: p.property,
          });
        }
      }
    }
    return streams;
  }

  private async request<T>(url: string): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as GoogleErrorBody;
        if (body?.error?.message) message = body.error.message;
      } catch {
        // non-JSON body — keep statusText
      }
      throw new Ga4AdminError(response.status, message);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
```
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/backend test ga4-admin.client`
- [ ] Run `pnpm verify`

---

### Task 3: `ContentApiClient.getAuthinfo()` (GMC accounts)
**Files:** Modify `apps/backend/src/modules/google/gmc/content-api.client.ts`; Test `apps/backend/test/unit/apps/google/content-api.client.test.ts`
- [ ] Write the failing test (append a new `it` inside the existing `describe`):
```ts
  it('getAuthinfo GETs accounts/authinfo and returns the merchant ids', async () => {
    const fetchImpl = recorder(() =>
      jsonResponse({ accountIdentifiers: [{ merchantId: '1234567' }, { aggregatorId: '99' }] }),
    );
    const client = makeClient(fetchImpl);

    const accounts = await client.getAuthinfo();

    expect(accounts).toEqual([{ merchantId: '1234567' }]);
    expect(calls[0].url).toBe(`${BASE}/accounts/authinfo`);
    expect(calls[0].init?.method).toBe('GET');
  });
```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/backend test content-api.client`
- [ ] Minimal implementation (add a method to `ContentApiClient`; `getAuthinfo` ignores the instance `merchantId` — the account id is what it discovers):
```ts
  /**
   * List the Merchant Center accounts the authenticated user can access.
   * GET `${baseUrl}/accounts/authinfo`
   */
  async getAuthinfo(): Promise<Array<{ merchantId: string }>> {
    const body = await this.request<{
      accountIdentifiers?: Array<{ merchantId?: string; aggregatorId?: string }>;
    }>('GET', `${this.baseUrl}/accounts/authinfo`);
    return (body.accountIdentifiers ?? [])
      .filter((a): a is { merchantId: string } => typeof a.merchantId === 'string')
      .map((a) => ({ merchantId: a.merchantId }));
  }
```
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/backend test content-api.client`
- [ ] Run `pnpm verify`

---

### Task 4: Discovery service (OAuth-only, partial-tolerant)
**Files:** Create `apps/backend/src/modules/google/discovery/discovery.service.ts`; Test `apps/backend/test/unit/apps/google/discovery.service.test.ts`
- [ ] Write the failing test:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';
import { DiscoveryService } from '../../../../src/modules/google/discovery/discovery.service';
import type { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';

function handleWith(connectionMethod: string | null): KyselyClient<GoogleDatabase> {
  const chain = {
    select: () => chain,
    where: () => chain,
    executeTakeFirst: async () => (connectionMethod ? { connectionMethod } : undefined),
  };
  return { db: { selectFrom: () => chain } } as unknown as KyselyClient<GoogleDatabase>;
}

const auth = { getAccessToken: async () => 'ya29.token' } as unknown as GoogleAuthService;

describe('DiscoveryService', () => {
  it('returns empty lists with a reason for a non-oauth (manual) merchant', async () => {
    const svc = new DiscoveryService(handleWith('manual'), auth);
    const result = await svc.discover('m1');
    expect(result.ga4.streams).toEqual([]);
    expect(result.gmc.accounts).toEqual([]);
    expect(result.ga4.error).toBeDefined();
  });

  it('returns GMC results even when GA4 discovery throws (partial-tolerant)', async () => {
    const svc = new DiscoveryService(handleWith('oauth'), auth);
    vi.spyOn(
      svc as unknown as { discoverGa4: () => Promise<unknown> },
      'discoverGa4',
    ).mockRejectedValueOnce(new Error('boom'));
    // gmc path is faked to succeed
    vi.spyOn(
      svc as unknown as { discoverGmc: () => Promise<unknown> },
      'discoverGmc',
    ).mockResolvedValueOnce({ accounts: [{ merchantId: '1234567' }] });

    const result = await svc.discover('m1');
    expect(result.ga4.streams).toEqual([]);
    expect(result.ga4.error).toBeDefined();
    expect(result.gmc.accounts).toEqual([{ merchantId: '1234567' }]);
  });
});
```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/backend test discovery.service`
- [ ] Minimal implementation (each integration wrapped so one failing never rejects `discover`; `Promise.allSettled` guards even if a private method throws synchronously):
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { GoogleDiscoverResponse } from '@ratio-app/shared/schemas/google-config';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { GoogleDatabase } from '../db/types';
import { ContentApiClient } from '../gmc/content-api.client';
import { Ga4AdminClient } from '../ga4/ga4-admin.client';
import { GoogleAuthService } from '../google-oauth/google-auth.service';
import { GOOGLE_DB_TOKEN } from '../kysely.module';

const OAUTH_REQUIRED = 'Connect a Google account (OAuth) to auto-detect.';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    @Inject(GOOGLE_DB_TOKEN) private readonly handle: KyselyClient<GoogleDatabase>,
    private readonly auth: GoogleAuthService,
  ) {}

  async discover(merchantId: string): Promise<GoogleDiscoverResponse> {
    const config = await this.handle.db
      .selectFrom('google_configs')
      .select(['connectionMethod'])
      .where('merchantId', '=', merchantId)
      .executeTakeFirst();

    if (config?.connectionMethod !== 'oauth') {
      return { ga4: { streams: [], error: OAUTH_REQUIRED }, gmc: { accounts: [], error: OAUTH_REQUIRED } };
    }

    const getAccessToken = () => this.auth.getAccessToken(merchantId);
    const [ga4, gmc] = await Promise.all([
      this.discoverGa4(getAccessToken).catch((err) => this.fail('ga4', err)),
      this.discoverGmc(getAccessToken).catch((err) => this.fail('gmc', err)),
    ]);
    return {
      ga4: 'streams' in ga4 ? ga4 : { streams: [], error: ga4.error },
      gmc: 'accounts' in gmc ? gmc : { accounts: [], error: gmc.error },
    };
  }

  private async discoverGa4(getAccessToken: () => Promise<string>) {
    const streams = await new Ga4AdminClient({ getAccessToken }).listWebMeasurementIds();
    return { streams };
  }

  private async discoverGmc(getAccessToken: () => Promise<string>) {
    // authinfo discovers the account id, so the instance merchantId is unused here.
    const client = new ContentApiClient({ merchantId: '', getAccessToken });
    const accounts = await client.getAuthinfo();
    return { accounts };
  }

  private fail(which: 'ga4' | 'gmc', err: unknown): { error: string } {
    this.logger.warn({ msg: `${which} discovery failed` });
    return { error: err instanceof Error ? err.message : 'discovery failed' };
  }
}
```
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/backend test discovery.service`
- [ ] Run `pnpm verify`

---

### Task 5: `GET google/api/discover` endpoint + module wiring
**Files:** Modify `apps/backend/src/modules/google/config/config.controller.ts`, `apps/backend/src/modules/google/google.module.ts`; Test `apps/backend/test/unit/apps/google/discover.endpoint.test.ts`
- [ ] Write the failing test (controller calls the service with the current merchant id):
```ts
import { describe, expect, it, vi } from 'vitest';
import { GoogleConfigController } from '../../../../src/modules/google/config/config.controller';
import type { GoogleConfigService } from '../../../../src/modules/google/config/config.service';
import type { GmcValidationService } from '../../../../src/modules/google/gmc/gmc-validation.service';
import type { DiscoveryService } from '../../../../src/modules/google/discovery/discovery.service';

describe('GoogleConfigController.discover', () => {
  it('delegates to DiscoveryService with the current merchant id', async () => {
    const payload = { ga4: { streams: [] }, gmc: { accounts: [] } };
    const discovery = { discover: vi.fn(async () => payload) } as unknown as DiscoveryService;
    const controller = new GoogleConfigController(
      {} as GoogleConfigService,
      {} as GmcValidationService,
      discovery,
    );

    const result = await controller.discover({ id: 'm1' } as never);

    expect(discovery.discover).toHaveBeenCalledWith('m1');
    expect(result).toBe(payload);
  });
});
```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/backend test discover.endpoint`
- [ ] Minimal implementation — in `config.controller.ts`: import `DiscoveryService` and `GoogleDiscoverResponse`, add it as a 3rd constructor param, and add the route:
```ts
  @Get('discover')
  @UseGuards(GoogleMerchantTokenGuard)
  async discover(@CurrentMerchant() merchant: Merchant): Promise<GoogleDiscoverResponse> {
    return this.discovery.discover(merchant.id);
  }
```
  Constructor becomes:
```ts
  constructor(
    private readonly config: GoogleConfigService,
    private readonly gmcValidation: GmcValidationService,
    private readonly discovery: DiscoveryService,
  ) {}
```
  In `google.module.ts`: import `DiscoveryService` and add it to the `providers` array (it injects `GOOGLE_DB_TOKEN` + `GoogleAuthService`, both already provided).
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/backend test discover.endpoint`
- [ ] Run `pnpm verify`

---

### Task 6: Callback redirects to the config page so it can auto-fill
**Files:** Modify `apps/backend/src/modules/google/google-oauth/google-oauth.controller.ts`; Test `apps/backend/test/unit/apps/google/google-connect.controller.test.ts`
- [ ] Write the failing test:
```ts
import { describe, expect, it, vi } from 'vitest';
import { GoogleConnectController } from '../../../../src/modules/google/google-oauth/google-oauth.controller';
import type { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';

describe('GoogleConnectController.callback', () => {
  it('exchanges the code and redirects to the admin config page with ?connected=1', async () => {
    const auth = { handleCallback: vi.fn(async () => {}) } as unknown as GoogleAuthService;
    const config = { get: () => 'http://localhost:5173' } as never;
    const redirects: string[] = [];
    const reply = { redirect: vi.fn(async (url: string) => { redirects.push(url); }) } as never;

    const controller = new GoogleConnectController(auth, config);
    await controller.callback('the-code', 'merchant-1', reply);

    expect(auth.handleCallback).toHaveBeenCalledWith('the-code', 'merchant-1');
    expect(redirects[0]).toBe('http://localhost:5173/config?connected=1');
  });
});
```
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/backend test google-connect.controller`
- [ ] Minimal implementation — change the callback redirect target:
```ts
    await reply.redirect(`${adminBase}/config?connected=1`, 302);
```
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/backend test google-connect.controller`
- [ ] Run `pnpm verify`

---

### Task 7: Admin auto-fill on return from connect
**Files:** Create `apps/admin-google/src/hooks/useDiscover.ts`; Modify `apps/admin-google/src/lib/queryKeys.ts`, `apps/admin-google/src/routes/config.tsx`; Test `apps/admin-google/src/routes/config.discover.test.tsx`
- [ ] Write the failing test (mirrors `config.test.tsx` setup — QueryClientProvider + merchant token; mock `api` to return config with empty ids + a single-candidate discover payload; load at `/config?connected=1`):
```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: vi.fn((method: string, path: string) => {
    if (path === '/api/google-config') {
      return Promise.resolve({
        connectionMethod: 'oauth', ga4Enabled: false, ga4MeasurementId: null,
        adsEnabled: false, adsConversionId: null, adsConversionLabel: null,
        enhancedConversionsEnabled: true, gmcEnabled: false, gmcMerchantId: null,
        gmcTargetCountry: 'IN', gmcContentLanguage: 'en', gmcCurrency: 'INR',
        gmcDefaultCondition: 'new', gmcBrandOverride: null, gmcCategoryMode: 'default',
        autoSyncEnabled: true, hourlyReconcileEnabled: true, syncVariantsEnabled: true,
        includeOutOfStock: true, freeListingsEnabled: true, hasGmcKey: false,
        googleAccountEmail: 'dev@example.com',
      });
    }
    if (path === '/api/discover') {
      return Promise.resolve({
        ga4: { streams: [{ measurementId: 'G-AUTO123' }] },
        gmc: { accounts: [{ merchantId: '7654321' }] },
      });
    }
    if (path === '/api/defaults') return Promise.resolve({ targetCountries: ['IN'], languages: ['en'], currencies: ['INR'], conditions: ['new'] });
    return Promise.resolve({});
  }),
}));

import { ConfigPage } from './config';
import { makeTestQueryClient, withMerchantToken } from '../test/harness'; // existing helpers used by config.test.tsx

describe('ConfigPage auto-discovery', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/config?connected=1');
    withMerchantToken('dev-merchant');
  });

  it('auto-fills the single GA4 + GMC candidate after returning from connect', async () => {
    render(
      <QueryClientProvider client={makeTestQueryClient()}>
        <ConfigPage />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect((screen.getByPlaceholderText('G-XXXXXXXXXX') as HTMLInputElement).value).toBe('G-AUTO123');
    });
    const gmc = screen.getByPlaceholderText('123456789') as HTMLInputElement;
    expect(gmc.value).toBe('7654321');
  });
});
```
> If `config.test.tsx` uses different harness helpers/placeholders, match them exactly when implementing (read it first). The GMC Merchant ID `Input` placeholder must be known — add `placeholder="123456789"` to the GMC Merchant ID input in this task if it lacks one.
- [ ] Run it — expect FAIL: `pnpm --filter @ratio-app/admin-google test config.discover`
- [ ] Minimal implementation:
  1. `queryKeys.ts` — add `discover: () => ['google', 'discover'] as const,`.
  2. `hooks/useDiscover.ts`:
```ts
import type { GoogleDiscoverResponse } from '@shared/schemas/google-config';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useDiscover(enabled: boolean) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.discover(),
    queryFn: () => api<GoogleDiscoverResponse>('GET', '/api/discover'),
    enabled: enabled && !!token,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}
```
  3. `routes/config.tsx` — in `ConfigPage`:
     - read the flag: `const justConnected = new URLSearchParams(window.location.search).get('connected') === '1';`
     - `const discover = useDiscover(justConnected);`
     - add an effect AFTER the existing `form.reset(...)` effect (so it wins over the reset of empty fields):
```ts
  useEffect(() => {
    const d = discover.data;
    if (!d) return;
    if (!form.getValues('ga4MeasurementId') && d.ga4.streams.length === 1) {
      form.setValue('ga4MeasurementId', d.ga4.streams[0].measurementId, { shouldDirty: true });
    }
    if (!form.getValues('gmcMerchantId') && d.gmc.accounts.length === 1) {
      form.setValue('gmcMerchantId', d.gmc.accounts[0].merchantId, { shouldDirty: true });
    }
  }, [discover.data, form]);
```
     - pass candidates to the sections: `<Ga4Section form={form} candidates={discover.data?.ga4.streams ?? []} />` and `<GmcSection ... candidates={discover.data?.gmc.accounts ?? []} />`.
  4. In `Ga4Section` (accept `candidates: { measurementId: string; displayName?: string; property?: string }[]`): render a picker ABOVE the Measurement ID `FieldRow` only when more than one candidate:
```tsx
        {candidates.length > 1 && (
          <FieldRow label="Detected GA4 properties">
            <Select
              placeholder="Pick a Measurement ID"
              style={{ width: '100%', maxWidth: 320 }}
              options={candidates.map((s) => ({
                value: s.measurementId,
                label: `${s.displayName ?? s.property ?? 'Property'} — ${s.measurementId}`,
              }))}
              onChange={(v) => form.setValue('ga4MeasurementId', v, { shouldDirty: true })}
            />
          </FieldRow>
        )}
```
  5. In `GmcSection` (accept `candidates: { merchantId: string }[]`): same pattern — a `Select` of `candidates` mapping to `gmcMerchantId`, shown only when `candidates.length > 1`; ensure the Merchant ID `Input` has `placeholder="123456789"`.
- [ ] Run it — expect PASS: `pnpm --filter @ratio-app/admin-google test config.discover`
- [ ] Run `pnpm verify`

---

### Task 8: Definition of Done
- [ ] `pnpm verify` green (lint + typecheck + test + build).
- [ ] Record the change via `remember` in `docs/agent/apps/google/CONTEXT.md` (what/why/files/links) + add a learning if the GA4 Admin / authinfo endpoints held a gotcha; update `FEATURES.md` (OAuth auto-discovery now built for GA4 + GMC; Ads still manual).
- [ ] Clear `PROGRESS.md`.

## Self-review
- AC "discover endpoint returns ga4+gmc, manual → empty+reason" → Tasks 4, 5.
- AC "partial-tolerant" → Task 4 (`Promise.all` + per-integration `.catch`).
- AC "GA4 web measurement ids + GMC authinfo, faked fetch, no token logging" → Tasks 2, 3.
- AC "callback → /config?connected=1" → Task 6.
- AC "auto-fill empty, dropdown when multiple, never clobber, no auto-save" → Task 7.
- AC "shared contract" → Task 1. AC "pnpm verify green" → every task + Task 8.
