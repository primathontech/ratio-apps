import type { FeedItemStatus } from '@shared/schemas/google-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface FeedSummary {
  synced: number;
  warnings: number;
  errors: number;
  pending: number;
  lastSyncAt: string | null;
}

export interface FeedItem {
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string;
  status: FeedItemStatus;
  hasGtin: boolean;
  issue: string | null;
  lastSyncedAt: string | null;
}

export interface FeedItemsResponse {
  items: FeedItem[];
  total: number;
}

export interface FeedHistoryRow {
  syncType: string;
  productsChecked: number;
  productsUpdated: number;
  productsErrored: number;
  detail: string | null;
  createdAt: string;
}

export function useFeedSummary() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.feedSummary(),
    queryFn: () => api<FeedSummary>('GET', '/api/feed/summary'),
    enabled: !!token,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useFeedItems(status: string, page: number, limit = 20) {
  const token = useMerchantStore((s) => s.token);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status && status !== 'ALL') params.set('status', status);
  return useQuery({
    queryKey: queryKeys.feedItems(status, page, limit),
    queryFn: () => api<FeedItemsResponse>('GET', `/api/feed/items?${params.toString()}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useFeedHistory() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.feedHistory(),
    queryFn: () => api<FeedHistoryRow[]>('GET', '/api/feed/history'),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export interface FeedEventRow {
  offerId: string;
  productId: string;
  variantId: string | null;
  title: string | null;
  status: FeedItemStatus;
  previousStatus: FeedItemStatus | null;
  issue: string | null;
  syncType: string | null;
  createdAt: string;
}

export interface FeedEventsResponse {
  items: FeedEventRow[];
  total: number;
}

export function useFeedEvents(offerId: string, page: number, limit = 20) {
  const token = useMerchantStore((s) => s.token);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (offerId) params.set('offerId', offerId);
  return useQuery({
    queryKey: queryKeys.feedEvents(offerId, page, limit),
    queryFn: () => api<FeedEventsResponse>('GET', `/api/feed/events?${params.toString()}`),
    enabled: !!token,
    refetchOnWindowFocus: false,
  });
}

export function useForceSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ started: true }>('POST', '/api/feed/sync'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.feedSummary() });
      qc.invalidateQueries({ queryKey: queryKeys.feedHistory() });
    },
  });
}
