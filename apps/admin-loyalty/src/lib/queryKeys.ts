export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  defaults: () => ['loyalty', 'defaults'] as const,
  config: () => ['loyalty', 'config'] as const,

  dashboardSummary: (from?: string, to?: string) =>
    ['loyalty', 'dashboard', 'summary', from ?? '', to ?? ''] as const,
  dashboardTrend: (from?: string, to?: string) =>
    ['loyalty', 'dashboard', 'trend', from ?? '', to ?? ''] as const,
  dashboardRules: () => ['loyalty', 'dashboard', 'rules'] as const,
  dashboardQr: () => ['loyalty', 'dashboard', 'qr'] as const,
  dashboardBulk: (from?: string, to?: string) =>
    ['loyalty', 'dashboard', 'bulk', from ?? '', to ?? ''] as const,

  bulkOps: (page: number, limit: number) => ['loyalty', 'bulk-ops', page, limit] as const,
  bulkOp: (id: string) => ['loyalty', 'bulk-op', id] as const,

  rules: () => ['loyalty', 'rules'] as const,
  rule: (id: string) => ['loyalty', 'rule', id] as const,
  ruleCustomers: (id: string, page: number) => ['loyalty', 'rule-customers', id, page] as const,
  rulePerformance: (id: string) => ['loyalty', 'rule-performance', id] as const,

  qrCodes: () => ['loyalty', 'qr-codes'] as const,
  qrCode: (id: string) => ['loyalty', 'qr-code', id] as const,
  qrScans: (id: string, page: number) => ['loyalty', 'qr-scans', id, page] as const,

  exports: () => ['loyalty', 'exports'] as const,
  export: (id: string) => ['loyalty', 'export', id] as const,

  customers: (filtersKey: string, sort: string, page: number, limit: number) =>
    ['loyalty', 'customers', filtersKey, sort, page, limit] as const,
  customerProfile: (phone: string) => ['loyalty', 'customer', phone] as const,
} as const;
