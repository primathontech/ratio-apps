import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface DailyStat {
  day: string; // YYYY-MM-DD
  batches: number;
  dispatched: number;
  failed: number;
}

export interface FailureBreakdown {
  reason: string;
  events: number;
  lastMessage: string;
}

export interface CapiStats {
  daily: DailyStat[];
  totals: { batches: number; dispatched: number; failed: number };
  successRate: number | null;
  failures: FailureBreakdown[];
}

export function useCapiStats(days = 30) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.capiStats(days),
    queryFn: () => api<CapiStats>('GET', `/api/v1/capi/stats?days=${days}`),
    enabled: !!token,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
