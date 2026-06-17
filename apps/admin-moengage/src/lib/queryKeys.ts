export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['posthog', 'defaults'] as const,
  config: () => ['posthog', 'config'] as const,
} as const;
