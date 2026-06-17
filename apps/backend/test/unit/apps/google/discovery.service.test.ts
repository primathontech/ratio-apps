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
