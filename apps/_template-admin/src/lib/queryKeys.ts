export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['_template', 'defaults'] as const,
  config: () => ['_template', 'config'] as const,
} as const;
