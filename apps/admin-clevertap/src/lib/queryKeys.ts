export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['clevertap', 'defaults'] as const,
  config: () => ['clevertap', 'config'] as const,
  status: () => ['clevertap', 'status'] as const,
  deliveries: () => ['clevertap', 'deliveries'] as const,
} as const;
