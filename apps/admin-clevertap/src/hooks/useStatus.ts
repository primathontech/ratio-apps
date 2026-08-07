import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export interface ClevertapStatus {
  configComplete: boolean;
  serverEventsEnabled: boolean;
  lastEventAt: string | null;
  lastEventTopic: string | null;
  lastError: string | null;
  forwardedCount24h: number;
}

export function useStatus() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.status(),
    queryFn: () => api<ClevertapStatus>('GET', '/api/status'),
    enabled: !!token,
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
}
