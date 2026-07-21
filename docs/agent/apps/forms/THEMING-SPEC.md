# Form Builder — Rich Theming & Appearance Implementation Spec

This spec extends the existing token system (`--wz-*` custom properties + `themeVars()`) rather than rewriting it. Every touch-point cites the real files from the inventory. The guiding constraint: **defaults must reproduce today's exact look**, so an un-themed form is byte-for-byte unchanged.

---

## 1. Theme / Appearance Schema

### 1.1 Where it lives

Add a new `appearanceSchema` alongside the field schemas in `packages/shared/src/schemas/form-schema.ts`, and add one optional key to `formInputSchema` (lines 223-242). This is the keystone contract shared by admin builder, backend DTO, and SDK, so defining it here propagates everywhere.

**Design decision — `.optional()`, no `.default()`:** Keep `appearance` optional and *absent* by default rather than defaulting to a full object. Rationale: (a) existing rows have no appearance and must keep rendering with the baked-in `baseStyles` defaults; (b) `themeVars()` already supplies per-token fallbacks, so a missing `appearance` naturally yields today's look; (c) a Zod default would force a large object into every payload and every DB row unnecessarily. When present, each *sub-field* carries its own default so a partial object (e.g. only `colors.primary` set) is safe.

### 1.2 The Zod (to add to `form-schema.ts`)

```ts
// ── Appearance / theme ─────────────────────────────────────────
// Curated, XSS-safe font choices. Enum (not free string) so no value can
// smuggle CSS/url() into the shadow stylesheet. 'system' = current default.
export const FORM_FONT_FAMILIES = [
  'system',       // system-ui stack (current default — no network font)
  'inter',
  'roboto',
  'open-sans',
  'lato',
  'montserrat',
  'poppins',
  'source-serif',
  'merriweather',
] as const;

export const FORM_BUTTON_SHAPES = ['sharp', 'rounded', 'pill'] as const;
export const FORM_DENSITIES     = ['compact', 'comfortable', 'spacious'] as const;
export const FORM_LABEL_POSITIONS = ['top', 'left'] as const;

// Hex only (#rgb / #rrggbb / #rrggbbaa). Rejects rgb()/hsl()/url()/named
// colors so nothing dynamic reaches the CSS var. Validated again at config
// time for WCAG contrast (§5). max length is a cheap DoS guard.
const hexColor = z
  .string()
  .trim()
  .max(9)
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color');

const appearanceColorsSchema = z
  .object({
    primary:    hexColor.default('#0fb3a9'), // submit bg  (today's --wz-primary)
    background: hexColor.default('#ffffff'), // page/card bg (today's --wz-bg)
    surface:    hexColor.default('#ffffff'), // input bg   (defaults to bg today)
    text:       hexColor.default('#1a1a1a'), // fg         (today's --wz-fg)
    muted:      hexColor.default('#6b7280'), // muted text (today's --wz-muted)
    border:     hexColor.default('#e5e7eb'), // borders    (today's --wz-border)
    error:      hexColor.default('#c0392b'), // error text (today's literal)
    buttonText: hexColor.default('#ffffff'), // submit label (today's literal #fff)
  })
  .default({});

const appearanceTypographySchema = z
  .object({
    fontFamily: z.enum(FORM_FONT_FAMILIES).default('system'),
    baseSize:   z.number().int().min(12).max(20).default(14), // px; today ~14
  })
  .default({});

const appearanceLayoutSchema = z
  .object({
    radius:       z.number().int().min(0).max(32).default(10),   // today 10px
    density:      z.enum(FORM_DENSITIES).default('comfortable'),
    maxWidth:     z.number().int().min(280).max(960).default(640), // NEW cap
    buttonShape:  z.enum(FORM_BUTTON_SHAPES).default('rounded'),
    fullWidthButton: z.boolean().default(false), // today: align-self flex-start
    labelPosition:   z.enum(FORM_LABEL_POSITIONS).default('top'),
  })
  .default({});

export const appearanceSchema = z
  .object({
    colors:     appearanceColorsSchema,
    typography: appearanceTypographySchema,
    layout:     appearanceLayoutSchema,
  })
  .strict(); // reject unknown keys — same posture as the field schemas

export type FormAppearance = z.infer<typeof appearanceSchema>;
```

Then in `formInputSchema` (lines 223-242) add one line:

```ts
appearance: appearanceSchema.optional(),
```

Note `radius`/`baseSize`/`maxWidth` are stored as **numbers** (px), not CSS strings — this closes the injection door (a `string` radius could carry `10px;background:url(...)`). The SDK appends the `px` unit. `themeVars` currently takes `radius: '10px'` as a string; §2 changes it to accept the number and append `px`.

### 1.3 DB / migration impact

`appearance` should **not** be folded into `schema_json` — that column is the field array and its shape is contractually `FormField[]`. Follow the exact `schema_json` precedent with a new column:

- **New migration** `apps/backend/src/modules/forms/db/migrations/0003_form_appearance.ts` (0001 is frozen per `0002_export_jobs.ts:6-7`) adding `appearance_json JSON NULL` to `forms`, mirroring `schema_json` at `0001_initial.ts:107` but nullable.
- **Kysely type** in `apps/backend/src/modules/forms/db/types.ts` (`FormsTable`, lines 39-56):
  ```ts
  appearanceJson: ColumnType<FormAppearance | string | null, string | null, string | null>;
  ```
- **Service wiring** in `forms.service.ts`:
  - `create` (~59-70) and `update` (~148-157): `appearanceJson: input.appearance ? JSON.stringify(input.appearance) : null` (mysql2 does not auto-serialize — same reason as the `schema_json` stringify comment at 46-48).
  - `duplicate` (208-221): copy the column.
  - `FormEntity` (10-22) + `toEntity` (246-260): add `appearance?: FormAppearance`, parsed via a `parseAppearance` helper mirroring `parseSchema` (263-265): `JSON.parse` if string, pass through if object, `undefined` if null.
- **Public read path** — this is what actually reaches the widget. In `submissions/submissions.service.ts`: add `appearance?: FormAppearance` to `PublicFormSchema` (48-56) and include it in the `getPublicSchema` return (248-256). No controller change: `public-submissions.controller.ts` route `GET forms/public/v1/forms/:formId` just forwards the shape.

No change to `forms.controller.ts` — `formInputPipe` (lines 28,43,66) validates the new key automatically.

---

## 2. SDK Renderer Changes

Files: `packages/forms-sdk/src/theme.ts`, `packages/forms-sdk/src/ui/form-renderer.ts`, `packages/forms-sdk/src/client.ts`, `packages/forms-sdk/src/ui/…` boot path.

### 2.1 Close the wiring gap (the single biggest structural task)

Today `themeVars`/`FormsThemeInput` are defined and unit-tested but **never consumed** — `form-renderer.ts:7` imports only `baseStyles`. The rich theme requires building the consumption path that already exists in the sibling `wizzy-sdk` (`results-page.ts:165` injects `themeVars({primary})` via `unsafeCSS`).

Steps:

1. **Transport the appearance in the schema.** `client.ts` `PublicFormSchema` (13-21): add `appearance?: FormAppearance` (type-only import — Zod stays out of the bundle per `client.ts:1-4`). The backend `getPublicSchema` now serves it (§1.3).
2. **Hold it on the element.** In `form-renderer.ts`, add a reactive `@state() private appearance?: FormAppearance;` set inside `loadSchema()` (172-191) from `schema.appearance`.
3. **Inject per-instance themed vars.** Lit `static styles` (37-143) cannot see instance data, so add an *instance* style tag. In `render()` (374-395), prepend a `<style>` produced from `themeVars(this.appearance)`:
   ```ts
   html`<style>${unsafeCSS(themeVars(this.appearance))}</style>${body}`
   ```
   `themeVars` output is a `:host{…}` block of `--wz-*` values; custom properties pierce the shadow boundary and override the `baseStyles` defaults. This keeps `baseStyles` (the static sheet, good for dedup) as the fallback layer and layers per-form tokens on top — exactly the research-recommended pattern (defaults on `:host`, override via ancestor/`:host`).

### 2.2 Expand `themeVars()` and the token set (`theme.ts`)

Replace `FormsThemeInput` (9-12) and `themeVars` (19-23) so every schema token maps to a `--wz-*` variable. Accept the whole (optional) `FormAppearance` and emit all tokens with the current values as fallbacks:

New/expanded tokens (append to the existing 6):

| token | source | default (= today) |
|---|---|---|
| `--wz-primary` | colors.primary | `#0fb3a9` |
| `--wz-bg` | colors.background | `#fff` |
| `--wz-surface` | colors.surface | `#fff` |
| `--wz-fg` | colors.text | `#1a1a1a` |
| `--wz-muted` | colors.muted | `#6b7280` |
| `--wz-border` | colors.border | `#e5e7eb` |
| `--wz-error` | colors.error | `#c0392b` |
| `--wz-btn-text` | colors.buttonText | `#fff` |
| `--wz-radius` | layout.radius + `px` | `10px` |
| `--wz-font` | typography.fontFamily → stack | system stack |
| `--wz-font-size` | typography.baseSize + `px` | `14px` |
| `--wz-gap` | layout.density → gap px | `14px` (comfortable) |
| `--wz-pad-y` / `--wz-pad-x` | layout.density → input padding | `8px` / `10px` |
| `--wz-max-width` | layout.maxWidth + `px` | `640px` |
| `--wz-btn-radius` | layout.buttonShape | derived (see below) |

Density mapping (compact/comfortable/spacious): field-gap `10/14/20`, input pad-y `6/8/11`. Button shape: `sharp`→`0`, `rounded`→`var(--wz-radius)`, `pill`→`999px`. `fullWidthButton` toggles `--wz-btn-align` between `flex-start` and `stretch` (or drive width). `labelPosition:'left'` is handled with a `:host([data-label='left'])` variant that flips `.rf-field` to a two-column grid — set the attribute in `renderForm()`.

### 2.3 Replace hard-coded values with tokens (`form-renderer.ts` `static styles`)

Swap the literals identified in the inventory:
- `.rf-required` (61), `.rf-error` (77), `.rf-form-error` (140): `#c0392b` → `var(--wz-error)`
- `.rf-submit` text (120): `#fff` → `var(--wz-btn-text)`; radius → `var(--wz-btn-radius)`; padding → `var(--wz-pad-y) var(--wz-pad-x)`; add `align-self: var(--wz-btn-align)`
- `.rf-phone-prefix` bg (89) and `.rf-status` bg (131): `#f5f5f5` → `var(--wz-surface)` or a new `--wz-subtle` token
- input/select/textarea (63-75): padding → density tokens; already use border/bg/radius tokens
- `:host` font (theme.ts 40-47): `var(--wz-font)`; label/size literals → derive from `var(--wz-font-size)`
- form gap (47): `var(--wz-gap)`; add `max-width: var(--wz-max-width)` on `:host` or the form wrapper (`.rf` root)

**Add the missing focus ring** (research §4 — none exists today): a `:focus-visible` rule on inputs/select/textarea/submit using a `--wz-focus` token (default derived from primary), `outline: 2px solid var(--wz-focus); outline-offset: 2px`. Also add `@media (prefers-reduced-motion: reduce)` to null transitions. Success/closed literals (`#ecfdf3`/`#067647`) can stay hard-coded in P0 (semantic, low value to theme).

### 2.4 Custom fonts inside Shadow DOM

Use **document-level one-time injection** (research §2, technique #1 — the only reliable approach; `@font-face` inside a shadow root does not resolve). In `form-renderer.ts` `connectedCallback` (159-162), when `typography.fontFamily !== 'system'`, inject a single guarded `<link>` (or `@font-face`) into `document.head`:

```ts
// pseudocode — runs once per family per page
const id = `ratio-font-${family}`;
if (family !== 'system' && !document.getElementById(id)) {
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = GOOGLE_FONT_HREF[family]; // fixed map, enum-keyed → no injection
  document.head.appendChild(link);
}
```

`GOOGLE_FONT_HREF` is a hard-coded lookup keyed by the `FORM_FONT_FAMILIES` enum — the merchant never supplies a URL, so no `url()`/`@import` attack surface. `--wz-font` then references the family name; fonts loaded at document scope are usable inside shadow roots. System stack remains the default so the common case needs **zero network font** (protects the 16 KB widget budget). Bundle cost of the whole theming layer is data, not code — the enum map and expanded `themeVars` string are a few hundred bytes.

### 2.5 Custom-CSS escape hatch — **defer to P2, do not ship in P0/P1**

Rationale (research §3): raw CSS on an embeddable widget injected into arbitrary merchant sites is a data-exfiltration vector (attribute-selector + `background:url()` leaks field values char-by-char; `:has()` reaches hidden fields; `@font-face src` / `@import` make external requests). The token API above already covers the Tier-1 on-brand levers without any of that risk. If P2 demands it, the only acceptable design is: parse with a real CSS AST, **allowlist** properties/value-shapes (deny `url()`, `@import`, `@font-face`, attribute selectors, `:has()`, `position:fixed`, `content`), and inject **only into the shadow root, never `document.head`**. Document that decision explicitly rather than blocklisting.

---

## 3. Admin "Design" Tab

Files: `apps/admin-forms/src/routes/builder.$formId.tsx`, `apps/admin-forms/src/lib/builder-state.ts`, `apps/admin-forms/src/components/FormPreview.tsx`, `apps/admin-forms/src/hooks/useForms.ts`.

### 3.1 Where it slots in

The right panel today manually toggles `FieldSettings` ↔ `FormSettings` on `selectedKey` (builder.$formId.tsx 230-251). There are **no Tabs anywhere yet**. Smallest-change insertion: wrap the right-panel form-level content in an Orion `<Tabs>` with two tabs — **"Content"** (today's `FormSettings`) and **"Design"** (new `DesignSettings`). This appears only when `selectedKey === null` (field-level editing is unaffected). Orion re-exports antd's `Tabs`/`TabPane`/`SegmentedTabs`.

### 3.2 Controls (all from Orion/antd, already the project's library)

New component `apps/admin-forms/src/components/DesignSettings.tsx`, grouped with an Orion `<Collapse>`:

- **Presets** (top): `Segmented` or a row of `Card` swatches → applies a full `FormAppearance` preset in one `updateMeta`.
- **Colors** (`Collapse` panel): one `ColorPicker` (Orion/antd, first use) per token — primary, background, surface, text, muted, border, error, buttonText. Show hex input (antd `ColorPicker` has `format="hex"` + `showText`). Inline WCAG badge per pair (§5).
- **Typography**: `Select` (font family, options = `FORM_FONT_FAMILIES` with human labels) + `Slider` (base size 12-20).
- **Layout**: `Slider` (radius 0-32), `Segmented` (density: compact/comfortable/spacious), `Slider` or `InputNumber` (max width 280-960), `Segmented` (button shape: sharp/rounded/pill), `Switch` (full-width button), `Segmented` (label position: top/left).

### 3.3 State + persistence wiring

- `BuilderMeta` (builder-state.ts): add `appearance?: FormAppearance`. Reducer already has `updateMeta`; a Design control dispatches `{type:'updateMeta', patch:{appearance:{…}}}`. Consider a dedicated `updateAppearance` action doing a deep merge so single-token edits don't clobber the object.
- `EMPTY_BUILDER_STATE` / `load`: hydrate `appearance` from the fetched `FormEntity`.
- `FormEntity` (useForms.ts): add `appearance?`.
- `onSave` (builder.$formId.tsx 123-151) / `toFormInput()` helper: include `appearance` in the payload; the existing client-side `formInputSchema.safeParse` validates it for free.

### 3.4 Live preview

`FormPreview.tsx` (128 lines) currently accepts only `name, fields, submitLabel, mode` and hardcodes colors/fonts (`#1677ff`, inline `inputStyle`). Extend it:

- Add an `appearance?: FormAppearance` prop.
- Compute an inline `style` object (or a scoped `<style>` with the same `--wz-*` vars the SDK uses) from `appearance` and drive `inputStyle`, submit button, gaps, radius, font from it. Reusing the same token names keeps preview and SDK visually identical.
- Keep the existing Mobile (375px) / Desktop split; respect `maxWidth` in the Desktop card.

**Sketch:**

```
┌ Builder header: [Build] … [Preview] [Save] [Publish] ─────────────┐
├ Palette (180px) │ Canvas (flex 2) │ Right panel (flex 1) ──────────┤
│  text           │  [field]        │  ┌ Tabs ──────────────────┐   │
│  textarea       │  [field] ◀ sel  │  │ Content │ Design*      │   │
│  …              │  [+ add]        │  ├────────────────────────┤   │
│                 │                 │  │ ▸ Presets  [A][B][C]   │   │
│                 │                 │  │ ▸ Colors   □□□□□□□□     │   │
│                 │                 │  │ ▸ Typography  [Inter▾] │   │
│                 │                 │  │ ▸ Layout   ─●── radius │   │
│                 │                 │  └────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
   (Preview toggle → replaces panes with themed Mobile + Desktop cards)
```

---

## 4. New Field Types (beyond the current 8)

Each requires: (a) a branch in the discriminated union `formFieldSchema` (`form-schema.ts` 182-191) + type in `FORM_FIELD_TYPES` (12-21); (b) a `renderControl()` case (`form-renderer.ts` 461-566) + client `validateField` (236-298); (c) server re-validation in `submissions/schema-validator.service.ts`; (d) a palette entry + `makeField()` default + optional `TypeSpecificSettings` panel in the admin builder.

Ranked by frequency × on-brand impact (research §C):

| Rank | Type | P | Zod addition | Renderer | Admin note |
|---|---|---|---|---|---|
| 1 | **radio** (single-choice) | **P0** | `options: optionsSchema` (reuse dropdown's, 124-127) | radio-group list like `.rf-checks` (490-511) but `type=radio` | reuse `OptionsEditor` |
| 2 | **checkbox** (single consent) | **P0** | `{ required?: bool }` + optional `linkUrl/linkText` for policy link | single `type=checkbox` + inline label | consent copy field |
| 3 | **number** | **P0** | `{ min?, max?, step?, integer?: bool }` | `input type=number inputmode` | min/max/step inputs |
| 4 | **url** | **P1** | none extra (validate format at submit, like email) | `input type=url` | none |
| 5 | **rating** (stars) | **P1** | `{ max: int 3..10 default 5, icon?: 'star'\|'heart' }` | star row, keyboard-accessible radio group under the hood | max + icon select |
| 6 | **hidden** (URL param / UTM capture) | **P1** | `{ paramName: string }`, not user-visible | reads `URLSearchParams`, no DOM | param-name input |
| 7 | **scale / NPS** (0-10 linear) | **P2** | `{ min, max, minLabel?, maxLabel? }` | button/radio row | endpoints labels |
| 8 | **address** (composite) | **P2** | nested sub-fields | grouped block | structured editor |
| 9 | **signature** | **P2** | `{}` | canvas → data-URL upload via existing presign flow | — |

P0 rationale: radio, single-checkbox consent, and number are universal (present in all 7 researched builders), low-complexity, and reuse existing option/validation plumbing. Rating/url/hidden (P1) add polish and funnel value. Scale/address/signature/payment are P2 (higher complexity; signature/payment touch the upload + external-integration paths). **Payment** is deliberately out of scope here — it's a separate commerce/PCI workstream, not a theming/field concern.

For each: because read-back schema is **not** re-validated against Zod (`parseSchema` casts to `FormField[]`, inventory §b), the server `SchemaValidatorService.validate` must gain an explicit branch per new type — it currently reads `.type/.required/.validation/.options`, so radio/checkbox/number slot in naturally; rating/scale need new numeric-range checks.

---

## 5. Accessibility & Safety

- **WCAG contrast at config time (admin).** In `DesignSettings.tsx`, compute contrast for every meaningful pair using the WCAG relative-luminance formula (`(L1+0.05)/(L2+0.05)` after sRGB linearization — the WebAIM algorithm) and warn inline: text-on-background and text-on-surface ≥ **4.5:1** (normal) / **3:1** (large ≥18.66px bold or ≥24px); buttonText-on-primary ≥ 4.5:1; border-on-background and the focus ring ≥ **3:1** (UI-component contrast). On failure show an Orion `Alert`/badge; never block save, but optionally offer "auto-pick black/white button text". Add a tiny `contrast.ts` util in `apps/admin-forms/src/lib/`.
- **Host-page style-bleed protection (SDK).** Add to `:host` in `baseStyles` (theme.ts): `all: initial` (or `revert`) to neutralize inheritable font/color/line-height bleeding in from the merchant page — the last remaining bleed vector; it does **not** reset `--wz-*` custom properties, so tokens survive. Also add `box-sizing: border-box`, `contain: layout style`, `container-type: inline-size`, `display:block`, `max-width: var(--wz-max-width)`. Prefer `@container` over media queries since the widget's width is the merchant container's, not the viewport's.
- **Self-defined focus + reduced motion** (already in §2.3): required because UA/host focus styles don't reach the shadow root once `all:initial` is set.
- **Color values are enum/hex-validated, never free CSS** — `hexColor` regex + font enum mean no token can carry `url()`, `expression`, or a `;`-breakout. This is why raw custom CSS is deferred (§2.5); the token API delivers the on-brand result with essentially none of the CSS-injection surface.
- **Fonts loaded document-scope, opt-in only** (§2.4) from a fixed enum→URL map — merchants never supply font URLs.

---

## 6. Phased Plan

### P0 — Theming tokens + Design tab + SDK consumption (ship the core lever)
- `packages/shared/src/schemas/form-schema.ts`: add `appearanceSchema` + `appearance` key, `FORM_FONT_FAMILIES`/shape/density/label enums, and P0 field types (radio, checkbox, number).
- `apps/backend/src/modules/forms/db/migrations/0003_form_appearance.ts` (new) + `db/types.ts` (`appearanceJson`).
- `apps/backend/src/modules/forms/forms/forms.service.ts`: create/update/duplicate/`toEntity` + `parseAppearance`.
- `apps/backend/src/modules/forms/submissions/submissions.service.ts`: `PublicFormSchema` + `getPublicSchema` expose `appearance`.
- `apps/backend/src/modules/forms/submissions/schema-validator.service.ts`: radio/checkbox/number branches.
- `packages/forms-sdk/src/theme.ts`: expand `FormsThemeInput`→`FormAppearance`, full token set in `themeVars`, `:host{all:initial; container-type; contain}`, focus ring, reduced-motion.
- `packages/forms-sdk/src/ui/form-renderer.ts`: `appearance` state, inject `themeVars(this.appearance)` via `unsafeCSS`, replace hard-coded literals with `var(--wz-*)`, new P0 field renderers, focus styles.
- `packages/forms-sdk/src/client.ts`: `PublicFormSchema.appearance` (type-only).
- Admin: `DesignSettings.tsx` (new, colors/typography/layout controls), `Tabs` in right panel of `builder.$formId.tsx`, `BuilderMeta.appearance` + reducer + `onSave`, `FormEntity.appearance`, `FormPreview.tsx` appearance-driven styling, `lib/contrast.ts`.
- Update size-limit expectation for `dist/forms-widget.js` (16 KB budget) — verify with `pnpm size`.

### P1 — Presets, fonts, top field types
- Preset themes: a `FORM_APPEARANCE_PRESETS` const (in `apps/admin-forms/src/lib/`) of named full-`FormAppearance` objects; `Segmented`/swatch UI in `DesignSettings`. (See open Q on count.)
- Web-font loading path in `form-renderer.ts` `connectedCallback` + `GOOGLE_FONT_HREF` map; wire `--wz-font`.
- Field types: url, rating, hidden (schema + renderer + validator + palette/settings).
- Full WCAG contrast auto-suggest ("fix button text") in `DesignSettings`.

### P2 — Advanced
- Multi-step / pages: a structural change to `formFieldsSchema` (page/section grouping) + renderer step state + progress bar — largest item; scope separately.
- Cover / background image: needs asset upload (reuse presign flow) + `appearance.cover` sub-schema + renderer.
- Logo upload (see open Q).
- Scale/NPS, address, signature field types.
- Raw custom-CSS escape hatch — only if demanded, with AST allowlist + shadow-root-only injection (§2.5).

---

## 7. Open Product Questions

1. **Raw custom CSS?** Recommendation: **no** (defer to P2 behind an AST allowlist). The token API covers Tier-1 needs without the exfiltration risk. Confirm this is acceptable, or flag which merchants need it.
2. **How many preset themes, and who curates them?** Suggest 4-6 hand-built presets (e.g. Default/Teal, Midnight, Minimal, Warm, High-contrast). Need brand/design sign-off on the palette values.
3. **Logo upload** (Tier-1 brand signal in research §D)? Requires an asset-storage decision (reuse the file-upload presign/PUT flow → store a URL in `appearance.logo`) and a placement decision (above form? in success screen?). In P2 unless prioritized.
4. **Font library scope** — is the curated enum (~8 Google Fonts + system) enough, or is arbitrary Google Fonts / custom upload required? Enum keeps injection surface at zero; arbitrary fonts reopen it and add network cost.
5. **Contrast enforcement policy** — warn-only, or hard-block save on AA failure? Recommendation: warn + offer auto-fix, never block (matches every researched builder, none of which block).
6. **Success / thank-you screen theming & redirect-on-submit** (Tier-1/2 in research) — should the success message become a richer themed "ending screen" with optional redirect URL? Currently just `successMessage` text. Fits naturally as an `appearance`-adjacent P1/P2 add but needs product scoping.
7. **Where does `maxWidth` apply** — form only, or also a centered page layout when embedded full-bleed? Affects the `:host` layout rules.
8. **Dark mode** — no researched builder ships a first-class end-user toggle (all theme-driven). Confirm we likewise treat dark as "just another preset/colors" rather than an auto `prefers-color-scheme` switch (auto-switching would fight merchant-picked colors).

---

**Key implementation notes for the P0 developer:** (1) the whole feature hinges on closing the *vestigial* theming path — `themeVars` exists and is tested but `form-renderer.ts` never imports or calls it; wiring that (§2.1) is the first commit. (2) Defaults everywhere must equal today's baked-in `baseStyles` values so un-themed forms are visually unchanged. (3) `appearance` is a *new column*, not part of `schema_json`. (4) Store numeric tokens as numbers and append units in the SDK — never accept CSS-unit strings from the schema.