import type { WizzyCatalogStatus } from '@shared/schemas/wizzy-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface CatalogSummary {
  synced: number;
  pending: number;
  error: number;
  lastBulkSyncAt: string | null;
}

export interface CatalogItem {
  id: number;
  productId: string;
  wizzyId: string;
  title: string | null;
  status: WizzyCatalogStatus;
  issue: string | null;
  lastSyncedAt: string | null;
}

export interface CatalogItemsResponse {
  items: CatalogItem[];
  total: number;
}

export interface CatalogHistoryRow {
  syncType: string;
  productsChecked: number;
  productsSynced: number;
  productsErrored: number;
  detail: string | null;
  createdAt: string;
}

export function useCatalogSummary() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.catalogSummary(),
    queryFn: () => api<CatalogSummary>('GET', '/api/catalog/summary'),
    enabled: !!token,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCatalogItems(status: string, page: number, limit = 20) {
  const token = useMerchantStore((s) => s.token);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status && status !== 'ALL') params.set('status', status);
  return useQuery({
    queryKey: queryKeys.catalogItems(status, page, limit),
    queryFn: () => api<CatalogItemsResponse>('GET', `/api/catalog/items?${params.toString()}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useCatalogHistory() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.catalogHistory(),
    queryFn: () => api<CatalogHistoryRow[]>('GET', '/api/catalog/history'),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useForceSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ started: true }>('POST', '/api/catalog/sync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.catalogSummary() });
      qc.invalidateQueries({ queryKey: queryKeys.catalogHistory() });
    },
  });
}
