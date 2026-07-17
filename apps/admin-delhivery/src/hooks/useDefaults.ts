import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

/** Public config defaults the admin pre-fills the Config form with. */
export interface DelhiveryDefaults {
  pickupCutoff: string;
  awbTrigger: 'auto' | 'manual';
  defaultBox: { l: number; b: number; h: number };
}

export function useDefaults() {
  return useQuery({
    queryKey: queryKeys.defaults(),
    queryFn: () => api<DelhiveryDefaults>('GET', '/api/defaults', undefined, { auth: false }),
    staleTime: Infinity,
  });
}
