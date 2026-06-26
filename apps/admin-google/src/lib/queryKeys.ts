export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['google', 'defaults'] as const,
  config: () => ['google', 'config'] as const,
  discover: () => ['google', 'discover'] as const,
  feedSummary: () => ['google', 'feed', 'summary'] as const,
  feedItems: (status: string, page: number, limit: number) =>
    ['google', 'feed', 'items', status, page, limit] as const,
  feedHistory: () => ['google', 'feed', 'history'] as const,
  feedEvents: (offerId: string, page: number, limit: number) =>
    ['google', 'feed', 'events', offerId, page, limit] as const,
} as const;
