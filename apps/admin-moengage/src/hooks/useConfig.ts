import type { MoEngageConfig, MoEngageConfigInput } from '@shared/schemas/moengage-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => api<MoEngageConfig>('GET', '/api/moengage-config'),
    enabled: !!token,
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
    mutationFn: (input: MoEngageConfigInput) =>
      api<MoEngageConfig>('PUT', '/api/moengage-config', input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.config(), data);
    },
  });
}
