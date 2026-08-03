export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['fbt', 'defaults'] as const,
  config: () => ['fbt', 'config'] as const,
} as const;
