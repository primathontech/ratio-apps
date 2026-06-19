import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface CatalogConfigView {
  catalogId: string | null;
  syncEnabled: boolean;
  feedToken: string | null;
  hasCatalogToken: boolean;
  productIdType: string;
}

export interface CatalogSaveInput {
  catalogId?: string;
  catalogAccessToken?: string;
  syncEnabled?: boolean;
}

export interface CatalogSaveResult {
  catalogId: string | null;
  syncEnabled: boolean;
  feedToken: string;
  initialSyncStarted: boolean;
}

export interface CatalogSyncRun {
  id?: number;
  trigger?: string;
  status?: string;
  totalProducts?: number | null;
  successCount?: number | null;
  errorCount?: number | null;
  startedAt?: string;
  completedAt?: string | null;
}

export function useCatalogConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.catalogConfig(),
    queryFn: () => api<CatalogConfigView>('GET', '/api/v1/catalog/config'),
    enabled: !!token,
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useSaveCatalogConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CatalogSaveInput) =>
      api<CatalogSaveResult>('PUT', '/api/v1/catalog/config', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.catalogConfig() });
      qc.invalidateQueries({ queryKey: queryKeys.catalogStatus() });
    },
  });
}

export function useCatalogStatus(enabled: boolean) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.catalogStatus(),
    queryFn: () => api<{ runs: CatalogSyncRun[] }>('GET', '/api/v1/catalog/status'),
    enabled: !!token && enabled,
    retry: false,
    // Poll every 5s ONLY while a sync is actively running (to show live
    // progress); once it finishes — or if nothing's running — stop polling so
    // an idle Catalog tab doesn't hammer the backend every 5s forever.
    refetchInterval: (query) => (query.state.data?.runs?.[0]?.status === 'running' ? 5000 : false),
    refetchOnWindowFocus: false,
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  // TVariables = boolean: pass true for a hard sync (re-push every product,
  // ignore the content-hash skip), false for a normal incremental sync.
  return useMutation<{ started: boolean; force: boolean }, Error, boolean>({
    mutationFn: (force) =>
      api<{ started: boolean; force: boolean }>(
        'POST',
        `/api/v1/catalog/sync${force ? '?force=true' : ''}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.catalogStatus() });
    },
  });
}

export function useStopSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ stopping: boolean }>('POST', '/api/v1/catalog/sync/stop'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.catalogStatus() });
    },
  });
}
