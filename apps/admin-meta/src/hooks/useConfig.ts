import type { MetaConfig, MetaConfigInput } from '@shared/schemas/meta-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => api<MetaConfig>('GET', '/api/meta-config'),
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
    mutationFn: (input: MetaConfigInput) => api<MetaConfig>('PUT', '/api/meta-config', input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.config(), data);
    },
  });
}
