import { describe, expect, it, vi } from 'vitest';
import type { CryptoService } from '../../../../src/core/crypto/crypto.service';
import type { KyselyClient } from '../../../../src/core/db/kysely-factory';
import { GoogleAuthService } from '../../../../src/modules/google/google-oauth/google-auth.service';
import type {
  GoogleOAuthCreds,
  GoogleOAuthHttp,
} from '../../../../src/modules/google/google-oauth/google-oauth.http';
import type { GoogleDatabase } from '../../../../src/modules/google/db/types';

/**
 * `getGmcAccessToken` prefers a stored GMC service-account key (the manual
 * fallback for an OAuth-connected merchant whose Google login can't reach the
 * Merchant Center), and otherwise delegates to the normal `getAccessToken`.
 */
function handleWith(gmcServiceAccountKeyEnc: string | null): KyselyClient<GoogleDatabase> {
  const chain = {
    select: () => chain,
    where: () => chain,
    executeTakeFirst: async () => ({ gmcServiceAccountKeyEnc }),
  };
  return { db: { selectFrom: () => chain } } as unknown as KyselyClient<GoogleDatabase>;
}

const creds = {} as GoogleOAuthCreds;

describe('GoogleAuthService.getGmcAccessToken', () => {
  it('mints from the stored service-account key when one is present', async () => {
    const crypto = {
      decrypt: () => '{"client_email":"sa@x.iam","private_key":"k"}',
      encrypt: (s: string) => s,
    } as unknown as CryptoService;
    const http = {
      serviceAccountToken: vi.fn(async () => 'sa-token'),
    } as unknown as GoogleOAuthHttp;

    const auth = new GoogleAuthService(handleWith('enc-key'), crypto, http, creds);
    const token = await auth.getGmcAccessToken('m1');

    expect(token).toBe('sa-token');
    expect(http.serviceAccountToken).toHaveBeenCalledWith(
      '{"client_email":"sa@x.iam","private_key":"k"}',
      ['https://www.googleapis.com/auth/content'],
    );
  });

  it('falls back to the normal access token when no key is stored', async () => {
    const crypto = { decrypt: (s: string) => s, encrypt: (s: string) => s } as unknown as CryptoService;
    const http = {} as unknown as GoogleOAuthHttp;

    const auth = new GoogleAuthService(handleWith(null), crypto, http, creds);
    const spy = vi.spyOn(auth, 'getAccessToken').mockResolvedValue('oauth-token');

    const token = await auth.getGmcAccessToken('m1');

    expect(token).toBe('oauth-token');
    expect(spy).toHaveBeenCalledWith('m1');
  });
});
