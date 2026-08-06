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
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
