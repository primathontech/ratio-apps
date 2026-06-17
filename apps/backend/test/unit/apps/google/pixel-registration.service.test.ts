import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';
import { PixelRegistrationService } from '../../../../src/modules/google/sdk/pixel-registration.service';
import {
  WebPixelsApi,
  WebPixelsApiError,
} from '../../../../src/modules/google/sdk/web-pixels.api';

/** Records the `.set(...)` patches applied to google_configs. */
function fakeDb(configRow: Record<string, unknown>): {
  handle: KyselyClient<GoogleDatabase>;
  updates: Record<string, unknown>[];
} {
  const updates: Record<string, unknown>[] = [];
  const selectChain = (row: unknown) => ({
    selectAll: () => selectChain(row),
    select: () => selectChain(row),
    where: () => selectChain(row),
    limit: () => selectChain(row),
    executeTakeFirst: async () => row,
  });
  const db = {
    selectFrom: (table: string) =>
      selectChain(table === 'google_configs' ? configRow : { accessTokenEnc: 'enc-token' }),
    updateTable: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { where: () => ({ execute: async () => undefined }) };
      },
    }),
  };
  return { handle: { db } as unknown as KyselyClient<GoogleDatabase>, updates };
}

const crypto = { decrypt: (s: string) => s, encrypt: (s: string) => s } as unknown as CryptoService;

function makeService(api: Pick<WebPixelsApi, 'register'>, configRow: Record<string, unknown>) {
  const { handle, updates } = fakeDb(configRow);
  const svc = new PixelRegistrationService(handle, crypto, api as WebPixelsApi);
  return { svc, updates };
}

const ga4Only = {
  ga4Enabled: 1,
  ga4MeasurementId: 'G-TEST',
  adsEnabled: 0,
  adsConversionId: null,
  adsConversionLabel: null,
  enhancedConversionsEnabled: 1,
};

describe('PixelRegistrationService.registerPixels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on success stores the pixel id and marks status active', async () => {
    const register = vi.fn().mockResolvedValue({ pixelId: 'px_1' });
    const { svc, updates } = makeService({ register }, ga4Only);
    await svc.registerPixels('m1');
    expect(register).toHaveBeenCalledTimes(1);
    expect(updates[0]).toMatchObject({ ga4PixelStatus: 'active', ga4PixelId: 'px_1' });
  });

  it('marks status pending_api (NOT error, no throw) when the Web Pixels API is unavailable', async () => {
    const register = vi.fn().mockRejectedValue(new WebPixelsApiError('down', 'unavailable', 503));
    const { svc, updates } = makeService({ register }, ga4Only);
    await expect(svc.registerPixels('m1')).resolves.toBeUndefined();
    expect(updates[0]).toMatchObject({ ga4PixelStatus: 'pending_api' });
    expect(updates[0].ga4PixelId).toBeUndefined();
  });

  it('marks status error on a forbidden (scope/token) failure', async () => {
    const register = vi.fn().mockRejectedValue(new WebPixelsApiError('forbidden', 'forbidden', 403));
    const { svc, updates } = makeService({ register }, ga4Only);
    await svc.registerPixels('m1');
    expect(updates[0]).toMatchObject({ ga4PixelStatus: 'error' });
  });
});
