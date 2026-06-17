import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export interface DefaultsResponse {
  targetCountries: string[];
  languages: string[];
  currencies: string[];
  conditions: string[];
}

export function useDefaults() {
  return useQuery({
    queryKey: queryKeys.defaults(),
    queryFn: () => api<DefaultsResponse>('GET', '/api/defaults', undefined, { auth: false }),
    staleTime: Infinity,
  });
}
