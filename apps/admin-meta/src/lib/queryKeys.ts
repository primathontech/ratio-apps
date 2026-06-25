export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['meta', 'defaults'] as const,
  config: () => ['meta', 'config'] as const,
  catalogConfig: () => ['meta', 'catalog', 'config'] as const,
  catalogStatus: () => ['meta', 'catalog', 'status'] as const,
  webhookDeliveries: () => ['meta', 'catalog', 'webhook-deliveries'] as const,
  capiStats: (days: number) => ['meta', 'capi', 'stats', days] as const,
} as const;
