import type {
  LoyaltyConfig,
  LoyaltyConfigInput,
  LoyaltyConfigResponse,
} from '@shared/schemas/loyalty-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => api<LoyaltyConfigResponse>('GET', '/api/loyalty-config'),
    // Skip when no session token (was causing an infinite 401 retry loop).
    enabled: !!token,
    // Don't retry on any 4xx — neither 401 (no session), 403 (forbidden),
    // nor 404 (no config yet) is recoverable by retrying.
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    // Cache the config row for the navigation session. Mutations call
    // `qc.setQueryData(...)` after a successful save so we never serve a
    // stale view of the user's own edits.
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoyaltyConfigInput) =>
      api<LoyaltyConfig>('PUT', '/api/loyalty-config', input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.config(), data);
    },
  });
}

// ─── Storefront claim secret (QR claim v2) ─────────────────────────────────
//
// Reveal/rotate the per-merchant claim-signing secret so it can be pasted
// into the storefront server's `LOYALTY_CLAIM_SECRET` env var. Both are
// action-triggered (click "Reveal" / "Rotate"), not on-mount reads, so they
// are modeled as mutations rather than an `enabled`-gated query — the secret
// is never fetched until the merchant explicitly asks for it.

export interface ClaimSecretResponse {
  secret: string;
}

/** Lazy GET — call `.mutate()` from a "Reveal secret" button. */
export function useClaimSecret() {
  return useMutation({
    mutationFn: () => api<ClaimSecretResponse>('GET', '/api/loyalty-config/claim-secret'),
  });
}

/** Regenerates + persists a new secret; the previous one stops verifying immediately. */
export function useRotateClaimSecret() {
  return useMutation({
    mutationFn: () => api<ClaimSecretResponse>('POST', '/api/loyalty-config/claim-secret/rotate'),
  });
}
