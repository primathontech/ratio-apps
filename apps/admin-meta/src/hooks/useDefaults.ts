import type { EventMap } from '@shared/schemas/event-map';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

interface DefaultsResponse {
  eventMap: Record<string, string>;
  events: EventMap;
  dataSharingLevels: string[];
  productIdTypes: string[];
}

export function useDefaults() {
  return useQuery({
    queryKey: queryKeys.defaults(),
    queryFn: () => api<DefaultsResponse>('GET', '/api/defaults', undefined, { auth: false }),
    staleTime: Infinity,
  });
}
