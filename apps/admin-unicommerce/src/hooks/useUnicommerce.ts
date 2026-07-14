import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface SyncStatus {
  connected: boolean;
  active: boolean;
  killSwitch: boolean;
  tenantSlug: string | null;
  facilityCode: string | null;
  circuitBreakerTripped: boolean;
  failedItems: Array<{
    id: string;
    orderId: string;
    syncType: string;
    lastError: string;
    retryCount: number;
    updatedAt: string;
  }>;
}

export interface PreCheckResult {
  success: boolean;
  totalSkusChecked?: number;
  notFoundInUc?: string[];
  warning?: string | null;
  error?: string;
}

export interface TestConnectionResult {
  success: boolean;
  facilities?: Array<{ code: string; name: string }>;
  error?: string;
}

export function useSyncStatus(merchantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.syncStatus(merchantId ?? ''),
    queryFn: () => api<SyncStatus>('GET', `/api/uc/sync-status/${merchantId}`),
    enabled: !!merchantId,
    refetchInterval: 10_000,
  });
}

export function usePreCheck(merchantId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.preCheck(merchantId ?? ''),
    queryFn: () => api<PreCheckResult>('GET', `/api/uc/pre-check/${merchantId}`),
    enabled: !!merchantId,
    retry: false,
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (body: { tenantSlug: string; username: string; password: string }) =>
      api<TestConnectionResult>('POST', '/api/uc/test-connection', body),
  });
}

export function useActivate() {
  return useMutation({
    mutationFn: (body: {
      merchantId: string;
      tenantSlug: string;
      username: string;
      password: string;
      facilityCode: string;
    }) => api<{ success: boolean }>('POST', '/api/uc/activate', body),
  });
}

export function useRetry() {
  const token = useMerchantStore((s) => s.token);
  return useMutation({
    mutationFn: (itemId: string) =>
      api<{ success: boolean }>('POST', `/api/uc/retry/${itemId}`, undefined, { auth: !!token }),
  });
}

export function usePause(merchantId: string | undefined) {
  return useMutation({
    mutationFn: () => api<{ success: boolean }>('POST', `/api/uc/pause/${merchantId}`),
  });
}

export function useResume(merchantId: string | undefined) {
  return useMutation({
    mutationFn: () => api<{ success: boolean }>('POST', `/api/uc/resume/${merchantId}`),
  });
}

export function useDisconnect(merchantId: string | undefined) {
  return useMutation({
    mutationFn: () => api<{ success: boolean }>('POST', `/api/uc/disconnect/${merchantId}`),
  });
}
