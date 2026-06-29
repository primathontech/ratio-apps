import type { WizzyConfig, WizzyConfigInput } from '@shared/schemas/wizzy-config';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { useMerchantStore } from '../stores/useMerchantStore';

export function useConfig() {
  const token = useMerchantStore((s) => s.token);
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => api<WizzyConfig>('GET', '/api/wizzy-config'),
    enabled: !!token,
    retry: (_count, err) => {
      const status = (err as { status?: number }).status;
      return !status || status >= 500;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WizzyConfigInput) => api<WizzyConfig>('PUT', '/api/wizzy-config', input),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.config(), data);
    },
  });
}
