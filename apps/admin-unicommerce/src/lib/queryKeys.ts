export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  syncStatus: (merchantId: string) => ['unicommerce', 'sync-status', merchantId] as const,
  preCheck: (merchantId: string) => ['unicommerce', 'pre-check', merchantId] as const,
} as const;
