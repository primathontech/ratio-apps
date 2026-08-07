import type { ClevertapConfigInput, ClevertapConfigOutput } from '@shared/schemas/clevertap-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => api<ClevertapConfigOutput>('GET', '/api/clevertap-config'),
    enabled: !!token,
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export interface CatalogSyncResult {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  itemCount?: number;
}

export function useSyncCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<CatalogSyncResult>('POST', '/api/catalog/sync'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.config() });
      void qc.invalidateQueries({ queryKey: queryKeys.status() });
    },
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClevertapConfigInput) =>
      api<ClevertapConfigOutput>('PUT', '/api/clevertap-config', input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.config(), data);
      void qc.invalidateQueries({ queryKey: queryKeys.status() });
    },
  });
}
