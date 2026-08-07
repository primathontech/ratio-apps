import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface ClevertapDeliveryTopicHealth {
  topic: string;
  sent: number;
  failed: number;
  skipped: number;
  lastAt: string | null;
}

export interface ClevertapDeliveryFailure {
  topic: string;
  clevertapEvent: string;
  error: string | null;
  sentAt: string;
}

export interface ClevertapDeliveryHealth {
  windowHours: number;
  sent: number;
  failed: number;
  skipped: number;
  total: number;
  successRate: number | null;
  perTopic: ClevertapDeliveryTopicHealth[];
  recentFailures: ClevertapDeliveryFailure[];
}

export function useDeliveryHealth() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.deliveries(),
    queryFn: () => api<ClevertapDeliveryHealth>('GET', '/api/status/deliveries'),
    enabled: !!token,
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
}
