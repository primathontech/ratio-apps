export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  config: () => ['wizzy', 'config'] as const,
  catalogSummary: () => ['wizzy', 'catalog', 'summary'] as const,
  catalogItems: (status: string, page: number, limit: number) =>
    ['wizzy', 'catalog', 'items', status, page, limit] as const,
  catalogHistory: () => ['wizzy', 'catalog', 'history'] as const,
} as const;
