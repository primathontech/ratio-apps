import type { CLEVERTAP_REGIONS } from '@shared/constants/clevertap-events';
import type { EventMap } from '@shared/schemas/event-map';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';

export interface DefaultsResponse {
  eventMap: Record<string, string>;
  events: EventMap;
  regions: typeof CLEVERTAP_REGIONS;
}

export function useDefaults() {
  return useQuery({
    queryKey: queryKeys.defaults(),
    queryFn: () => api<DefaultsResponse>('GET', '/api/defaults', undefined, { auth: false }),
    staleTime: Infinity,
  });
}
