import type { GoogleDiscoverResponse } from '@shared/schemas/google-config';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useDiscover(enabled: boolean) {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.discover(),
    queryFn: () => api<GoogleDiscoverResponse>('GET', '/api/discover'),
    enabled: enabled && !!token,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}
