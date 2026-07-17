import type { Merchant } from '@shared/schemas/merchant';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useMerchant() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.merchant(),
    queryFn: () => api<Merchant>('GET', '/api/merchants/me'),
    // Don't even attempt without a session token, saves the 401 round-trip
    // (and the infinite retry loop the admin used to do).
    enabled: !!token,
    retry: false,
    // Merchant identity is stable across the session, cache the result and
    // avoid the React-Strict-Mode-double-mount → duplicate-network-call dance.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
