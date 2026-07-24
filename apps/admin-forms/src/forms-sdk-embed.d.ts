// Glue for embedding the real storefront renderer in the admin preview.
//
// FormPreview side-effect-imports the SDK element source with a `?sdk` query so
// Vite bundles `form-renderer.ts` under the SDK's own tsconfig (legacy Lit
// decorators), while the admin `tsc` — which runs with `experimentalDecorators`
// off — never descends into that source. This wildcard keeps the query-suffixed
// specifier typed (as an opaque, side-effect-only module) instead of unresolved.
declare module '*?sdk';
