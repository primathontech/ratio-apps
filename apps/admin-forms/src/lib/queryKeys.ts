export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['forms', 'defaults'] as const,
  config: () => ['forms', 'config'] as const,
} as const;
