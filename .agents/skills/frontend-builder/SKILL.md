---
name: frontend-builder
description: Implement the admin SPA screens described in the PRD on the scaffolded admin app — the config form bound to the backend config API plus the dashboards — using the React 19 + Vite + TanStack Router patterns. Verifies with admin typecheck and build, and updates STATE.json.
when_to_use: The phase after backend-builder. Use to build the vendor's admin UI (config form + dashboards) on the scaffolded apps/admin-<slug> shell so it talks to the implemented backend. Consults stack-patterns.
---

# frontend-builder

You implement the admin SPA screens from the PRD on the scaffolded admin app
(`apps/admin-<slug>/`). The scaffold already builds and points its API layer at
the `/<slug>` backend namespace; your job is the real screens.

Read STATE.json on entry for `slug` and `paths.admin`. Read
`docs/agent/apps/<slug>/PRD.md` (Admin screens section), `TRD.md` (route/API
design), and `TDD.md` (the frontend test cases you satisfy). Consult
`stack-patterns` for the React/Vite/TanStack-Router patterns, and
`house-conventions`.

**Test-driven:** for each frontend case in `TDD.md`, write the failing test first
(Vitest + Testing Library, alongside the component under `src/`), then implement
the screen until it passes.

## What to implement (per the PRD)

### 1. Config form (`src/routes/config.tsx`)

Bind the form to the backend config API:
- Resolve the `react-hook-form` form against the shared `<slug>ConfigInputSchema`
  (`@shared/schemas/<slug>-config`) via `zodResolver`.
- Load current config with `useConfig()` and save with `useUpdateConfig()`
  (`src/hooks/useConfig.ts`) — both hit `/api/<slug>-config` through the `api()`
  wrapper, which already prepends `/<slug>`.
- Render one field per config column from the PRD (the backend now defines these);
  pre-fill defaults from the public `defaults` endpoint via `useDefaults()`.
- Surface validation + save errors visibly (follow the template's
  `handleSubmit(onValid, onInvalid)` + `Alert` pattern). Use `@primathonos/orion`
  components.

### 2. Dashboard / landing + other screens

Implement `src/routes/index.tsx` and any additional routes the PRD lists. Add new
file-based routes under `src/routes/`; React Query hooks for any data they read
(mirror `useConfig.ts`); display per the PRD. Keep `__root.tsx`'s iframe-auth +
install-session bootstrap intact.

### 3. Wire data + navigation

- Add React Query hooks for any new backend endpoints the screens consume,
  attaching the Bearer token (handled by the `api()` wrapper).
- Update `Navbar`/route tree so the new screens are reachable.

### 4. Storefront SDK (only when `hasStorefrontSdk: true`)

**Skip unless STATE.json sets `hasStorefrontSdk: true`** (most apps are false).
When set, after the admin is done, implement the storefront SDK package
(`packages/<slug>-sdk`, scaffolded from `_template-sdk`) per the **stack-patterns
"Storefront SDK patterns"** section — the Lit 3 Web Components, the typed vendor
`Client` (`src/client.ts`, real search-API base URL + endpoints, public creds
only), the loader/widget/results bundles, and `RecentStore`/anon-id. Consult the
**`packages/wizzy-sdk`** reference. Verify with the SDK's own gates:

```bash
cd packages/<slug>-sdk && pnpm typecheck && pnpm test && pnpm build && pnpm size
```

`size` (size-limit) must pass: loader ≤ 3 KB, widget ≤ 10 KB, results ≤ 16 KB.

## Remove every `// TEMPLATE:` marker

```bash
grep -rn "// TEMPLATE:" apps/admin-<slug>/src
```

None should remain.

## Verify

```bash
cd apps/admin-<slug> && pnpm typecheck && pnpm test && pnpm build
```

All must PASS. `typecheck` runs `tsr generate && tsc --noEmit`; `test` runs the
Vitest suite (every frontend case from `TDD.md` now green); `build` runs
`tsr generate && tsc --noEmit && vite build` and emits the static `dist/` the
backend serves as the single deploy artifact. Fix all errors before advancing.

## Update STATE.json

Via `context-keeper`: append the screen files to `filesCreated`; append a
`frontend-builder` history entry; advance `phase` to `code-reviewer`. Hand back
to `build-app`.

## When stuck

- Compare against `apps/_template-admin/src/` — the config-form, hooks, and
  api-layer patterns are identical; only fields/screens change.
- If a save silently does nothing, you likely hit a Zod input/output mismatch in
  the form resolver — resolve against the **input** schema (`z.input`), as the
  template does, since the backend backfills defaulted fields.
- If routes don't appear, re-run `tsr generate` (the `routes:gen` script).
