// Vendor-agnostic core

// _template vendor example (genericized starting point — a scaffolded vendor
// gets its own `<slug>-events` / `<slug>-config` modules alongside these).
export * from './constants/_template-events';
// forms vendor (Form Builder — first-party app).
export * from './constants/forms-events';
// google vendor (scaffolded) — vendor-specific config/events alongside the template example.
export * from './constants/google-events';
// meta vendor (scaffolded) — vendor-specific config/events + CAPI ingest schema.
export * from './constants/meta-events';
export * from './constants/moengage-events';
export * from './constants/openstore-events';
// posthog + moengage vendors (scaffolded).
export * from './constants/posthog-events';
export * from './schemas/_template-config';
export * from './schemas/capi-ingest';
// Schemas
export * from './schemas/event-map';
export * from './schemas/form-schema';
export * from './schemas/forms-config';
export * from './schemas/google-config';
export * from './schemas/merchant';
export * from './schemas/meta-config';
export * from './schemas/moengage-config';
export * from './schemas/posthog-config';
// wizzy vendor (AI search & discovery) — search/autocomplete API + storefront config schemas.
export * from './schemas/wizzy-search';
