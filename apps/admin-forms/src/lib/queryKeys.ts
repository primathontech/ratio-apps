export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
  config: () => ['forms', 'config'] as const,
  forms: (page: number) => ['forms', 'list', page] as const,
  formsAll: () => ['forms', 'list'] as const,
  form: (id: string) => ['forms', 'detail', id] as const,
  submissions: (formId: string, page: number) => ['forms', 'submissions', formId, page] as const,
  submissionDetail: (id: string) => ['forms', 'submission', id] as const,
  deliveries: (formId: string, page: number) => ['forms', 'deliveries', formId, page] as const,
  deliveriesAll: (formId: string) => ['forms', 'deliveries', formId] as const,
} as const;
