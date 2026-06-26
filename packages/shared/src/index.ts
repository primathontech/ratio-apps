// Vendor-agnostic core

// _template vendor example (genericized starting point — a scaffolded vendor
// gets its own `<slug>-events` / `<slug>-config` modules alongside these).
export * from './constants/_template-events';
export * from './constants/openstore-events';
export * from './schemas/_template-config';
// google vendor (scaffolded) — vendor-specific config/events alongside the template example.
export * from './constants/google-events';
export * from './schemas/google-config';
// meta vendor (scaffolded) — vendor-specific config/events + CAPI ingest schema.
export * from './constants/meta-events';
export * from './schemas/meta-config';
export * from './schemas/capi-ingest';
// posthog + moengage vendors (scaffolded).
export * from './constants/posthog-events';
export * from './schemas/posthog-config';
export * from './constants/moengage-events';
export * from './schemas/moengage-config';
// Schemas
export * from './schemas/event-map';
export * from './schemas/merchant';
// wizzy vendor (AI search & discovery) — search/autocomplete API + storefront config schemas.
export * from './schemas/wizzy-search';
