// Query-key namespaces for this admin. Only what is actually fetched today —
// the `config`, `bundles`, and `dashboard` keys land with the endpoints that
// back them (Plans 2 and 4) rather than sitting here unused.
export const queryKeys = {
  merchant: () => ['merchant', 'me'] as const,
} as const;
