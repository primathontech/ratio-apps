export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['delhivery', 'defaults'] as const,
  config: () => ['delhivery', 'config'] as const,
  shipmentsRoot: () => ['delhivery', 'shipments'] as const,
  shipments: (page: number, status: string) => ['delhivery', 'shipments', page, status] as const,
  pendingOrders: (page: number) => ['delhivery', 'shipments', 'pending', page] as const,
} as const;
