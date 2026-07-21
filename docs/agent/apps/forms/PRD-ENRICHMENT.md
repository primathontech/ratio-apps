# PRD — Form Builder Enrichment (Rich Theming, Visual Controls & Per-Field Depth)

> **Single complete specification of the Form Builder enrichment PR.** This is the
> authoritative umbrella document. It records exactly what shipped this session
> (DELIVERED, cross-checked against the merged code), the complete ranked plan for
> per-field and theming enrichment (PLANNED), the enabling architecture, the data
> model, the data flow, and the acceptance / rollout / deferral decisions.
>
> Companion source docs (all folded into this document): `PRD.md` (the original
> shipped Form Builder), `THEMING-SPEC.md`, `VISUAL-CONTROLS-CATALOG.md`,
> `THEMING-SECTION-CATALOG.md` (12 sections), `FIELD-ENRICHMENT-PLAN.md` (per-field).

---

## Table of contents

1. Overview, problem, goals, non-goals
2. Design invariants
3. DELIVERED this session (theming tokens, 18 field types, per-field props, presets, Design tab, WYSIWYG preview, migrations 0003/0004)
4. PLANNED — per-field enrichment (all 15 collectable field types + content blocks, every P0/P1/P2 row)
5. PLANNED — theming / visual enrichment (all 12 theming sections, every P0/P1/P2 row, plus the a11y defects)
6. Cross-cutting reusables (build once, consume everywhere)
7. Architecture — the per-field module refactor
8. Data model — tables/columns touched, the one new migration, the `files_json` reshape
9. Data flow, API surface, public read path
10. Acceptance criteria, phased rollout / build order, deferred Tier-3, open questions

---

## 1. Overview, problem, goals, non-goals

### 1.1 Overview

The Form Builder (see `PRD.md`) shipped functional but visually minimal. This PR
enriches it along two axes simultaneously:

- **Theming & visual controls** — a full appearance-token system so a merchant can
  make an embedded form genuinely on-brand without writing CSS, driven from an
  admin **Design** tab and rendered by the real storefront SDK.
- **Per-field depth** — every field type deepened toward parity with best-in-class
  form builders (masks, multi-country phone, searchable dropdowns, date ranges,
  multi-file upload, currency/number formatting, rich rating, hidden-field
  provenance, content blocks, etc.).

Both axes are delivered under one hard constraint: the widget is injected into
arbitrary third-party merchant sites, so the security posture may never weaken.

### 1.2 Problem

The storefront widget originally exposed only a primary color + corner radius; the
form schema had no appearance options; each field type carried only its basic
input. Embedded on a real store the form read as a bare, unstyled stack of inputs —
"vague," off-brand, a placeholder. Merchants could not match their brand, and
power-field needs (multi-country phone, searchable dropdowns, date ranges,
multi-file upload, currency inputs, etc.) were unmet.

### 1.3 Goal

A form a non-technical merchant can make genuinely professional and on-brand in
minutes, and that a power user can configure deeply — **without ever writing CSS**,
and **without weakening the security posture** of a widget injected into arbitrary
third-party sites.

### 1.4 Non-goals / out of scope

| Item | Disposition |
|---|---|
| Raw merchant-authored CSS | Deferred (Tier 3). Only ever behind a CSS AST allowlist, shadow-root-only injection. |
| `@font-face` / custom font upload | Deferred (Tier 3). Breaks the enum-only, no-dynamic-URL font posture. |
| Video backgrounds | Deferred (Tier 3). Off-origin fetch + autoplay a11y conflicts with the no-off-origin posture. |
| Multi-step / paged forms + progress bar | Separate workstream (schema + renderer step engine). Progress-bar tokens stubbed for it. |
| Payments / commerce fields | Separate PCI workstream. |
| Conditional logic, answer piping | Deferred (needs a logic engine). |
| New external services | None. Email/S3/webhook workers remain env-gated as today. |

**Original v1 out-of-scope (folded from `PRD.md` — still out of scope unless a row
above re-scopes it):**

- **Visual Editor "Form" section type** — platform-side change owned by the core
  team; v1 (and this PR) ships with SDK script/iframe embed only. Raised as a parallel
  platform ask.
- **Payment / checkout fields** (GoKwik's domain).
- **Conditional logic, multi-step forms, partial submissions** (v2 / separate
  workstreams; progress-bar tokens are stubbed — §1.4 above, §10.3).
- **Direct CRM integrations** (Clevertap/Moengage/HubSpot) — the webhook covers v1.
- **International phone country picker** — +91 only in v1 *(the enrichment adds a
  multi-country dial-code selector as a planned P0 — §4.4)*.
- **Custom redirect URL after submit** (v1.1) *(delivered as `redirect_url` in this
  PR — §3.7)*; **custom sender domain** (Phase 2).
- **Survey / NPS features; forms embedded in email.**
- **Submission retention auto-deletion** — policy TBD with Legal; manual for now.

---

## 2. Design invariants

These constraints hold across every delivered and planned item. They are the
acceptance backbone.

1. **Backward compatible.** Every new appearance token and field prop defaults to
   today's baked-in value. An un-themed or pre-existing form renders **byte-for-byte
   identically**. `themeVars(undefined)` reproduces the current look; each
   sub-schema uses `.prefault({})` so partial objects fill per-token defaults.

2. **No DB migration for config.** Appearance lives in the `appearance_json` JSON
   column; field config lives in the `schema_json` JSON column. New keys are pure
   Zod additions — no schema migration. `appearanceSchema` is `.strict()`, so every
   new **global** appearance key must be declared or parsing rejects it. The only
   column-level migrations were the additive `0003` (`appearance_json`) and `0004`
   (`description`, `redirect_url`), both nullable and reversible.

3. **Security model (never weakened).** Merchant values reach the Shadow-DOM widget
   only as one of:
   - **hex colors** (`#rgb`/`#rrggbb`/`#rrggbbaa`, `hexColor` regex, max length 9 — rejects `rgb()`/`hsl()`/`url()`/named/`;`-breakout),
   - **enum members** (fonts, shapes, densities, variants, directions, fits, icons, marks, …),
   - **`https://` asset URLs** (`httpsAssetUrl`, max 2048; the component re-validates and builds every `url()` itself via `safeCssUrl`, rejecting any `)`, `,`, quote, or whitespace),
   - **bounded numbers / bounded strings**.

   Values enter as **CSS custom-property values** (the `themeVars()` string) or
   **reflected host `data-*` attributes** — never as stylesheet source text.
   Content that could carry markup (paragraph text, headings, help text, labels,
   prefix/suffix) is rendered via **`textContent`, never `innerHTML`**. Gradients
   and scrims are pure inert CSS functions composed from hex + enum + bounded
   numbers (no URL). This is why raw CSS is deferred: the token API delivers the
   on-brand result with essentially none of the CSS-injection surface (an
   attribute-selector + `background:url()` exfiltration vector).

4. **WYSIWYG.** The admin preview embeds the **real SDK renderer** (`<ratio-form>`
   in inline preview mode). What a merchant designs is exactly what ships — there is
   no second, hand-maintained preview renderer to drift.

5. **Widget stays small.** Storefront widget budget **32 KB** (raised from 16 KB
   for the richer feature set). Token strings + `data-*` attribute variants over
   per-variant CSS bloat; curated inline-SVG maps capped and shared through one
   template renderer; admin-only utilities (presets, contrast, palette extraction)
   never imported into `packages/forms-sdk`.

6. **Accessibility (WCAG AA).** WCAG-AA contrast checks on merchant colors (warn +
   auto-fix, never block save). A visible focus indicator is never removed
   (`:focus-visible` always draws; `all: initial` on `:host` means UA/host focus
   never reaches the shadow root, so the widget defines its own). `prefers-reduced-motion`
   is respected (durations collapse to ~0.01ms, preserving `transitionend`).

---

## 3. DELIVERED (this session)

Everything in this section is present in the merged branch and was cross-checked
against the code. File references are absolute-relative to the repo root.

### 3.1 Appearance token system

`appearance` is an optional object on the form, persisted in `appearance_json`,
validated by `appearanceSchema` (`.strict()`) in
`packages/shared/src/schemas/form-schema.ts`, transported on the public read schema,
and consumed by `themeVars()` in `packages/forms-sdk/src/ui/theme.ts` which emits a
`:host { --wz-* }` block inlined per instance by `form-renderer.ts`.

The `appearance` object has six top-level groups: `colors`, `typography`, `layout`,
`background`, `logo?`, `cover?`.

#### 3.1.1 Color tokens (`appearance.colors`) — all 9

| Schema key | Purpose | Default (= today) | Emits |
|---|---|---|---|
| `primary` | submit button background / accents | `#0fb3a9` | `--wz-primary` (+ derived `--wz-primary-hover` = `color-mix(primary 85%, #000)`) |
| `background` | form **card** background | `#ffffff` | `--wz-bg` |
| `pageBackground` | area **around** the card | `#ffffff` | `--wz-page-bg` (transparent unless distinct from card / gradient / image) |
| `surface` | input background | `#ffffff` | `--wz-surface` (+ derived `--wz-subtle` = `color-mix(surface 92%, fg)` for status boxes / phone chip / adornment chips) |
| `text` | foreground text | `#1a1a1a` | `--wz-fg` |
| `muted` | muted/secondary text | `#6b7280` | `--wz-muted` |
| `border` | borders | `#e5e7eb` | `--wz-border` |
| `error` | error text / rings | `#c0392b` | `--wz-error` |
| `buttonText` | submit label color | `#ffffff` | `--wz-btn-text` |

#### 3.1.2 Typography tokens (`appearance.typography`)

| Schema key | Purpose | Default | Emits |
|---|---|---|---|
| `fontFamily` | curated web font (enum `FORM_FONT_FAMILIES`) | `system` | `--wz-font` (resolved via `FONT_STACKS`) |
| `baseSize` | base font size, px, int 12–20 | `14` | `--wz-font-size` |

The 9 curated font families (`FORM_FONT_FAMILIES`): **`system`, `inter`, `roboto`,
`open-sans`, `lato`, `montserrat`, `poppins`, `source-serif`, `merriweather`**.
Non-`system` families load one guarded `<link>` at **document scope** (shadow roots
can't resolve `@font-face` locally) from the fixed enum-keyed `GOOGLE_FONT_HREF` map
— the merchant never supplies a URL.

#### 3.1.3 Layout tokens (`appearance.layout`) — all 19

| Schema key | Type / enum | Default (= today) | Emits / effect |
|---|---|---|---|
| `radius` | int 0–32 (px) | `10` | `--wz-radius` |
| `density` | `FORM_DENSITIES` = compact/comfortable/spacious | `comfortable` | `--wz-gap`, `--wz-pad-y`, `--wz-card-pad` via `DENSITY` map (gap 10/14/20, padY 6/8/11, cardPad 20/28/36) |
| `maxWidth` | int 280–960 (px) | `640` | `--wz-max-width` |
| `buttonShape` | `FORM_BUTTON_SHAPES` = sharp/rounded/pill | `rounded` | `--wz-btn-radius` (sharp→0, rounded→`var(--wz-radius)`, pill→999px) |
| `fullWidthButton` | bool | `false` | `--wz-btn-align: stretch` when true |
| `buttonAlign` | `FORM_BUTTON_ALIGNMENTS` = left/center/right | `left` | `--wz-btn-align` (align-self) when not full-width |
| `labelPosition` | `FORM_LABEL_POSITIONS` = top/left/floating | `top` | reflects `data-label`; left → 2-col grid; floating → animated inline label |
| `cardBorder` | bool | `true` | `--wz-card-border` (1px solid or none) |
| `shadow` | `FORM_SHADOWS` = none/sm/md | `sm` | `--wz-card-shadow` via `SHADOWS` map |
| `inputVariant` | `FORM_INPUT_VARIANTS` = outlined/filled/underlined | `outlined` | reflects `data-input`; token-flip (`--_fill`/`--_bw`/`--_r`) |
| `buttonSize` | `FORM_BUTTON_SIZES` = sm/md/lg | `md` | `--wz-btn-pad-y`, `--wz-btn-font` via `BUTTON_SIZE` map |
| `buttonIcon` | `FORM_BUTTON_ICONS` = none/arrow/check/send | `none` | leading `<svg>` from curated `BUTTON_ICONS` map |
| `fieldGap` | int 6–40, **optional** | absent (density wins) | overrides `--wz-gap` |
| `inputPadY` | int 4–18, **optional** | absent (density wins) | overrides `--wz-pad-y` |
| `focusStyle` | `FORM_FOCUS_STYLES` = ring/border/glow | `ring` | reflects `data-focus` |
| `focusWidth` | int 1–4 (px) | `2` | `--wz-focus-width` |
| `requiredMark` | `FORM_REQUIRED_MARKS` = asterisk/text/none | `asterisk` | `.rf-required` renders `*` / "Required" / nothing |
| `columns` | `FORM_COLUMN_MODES` = 1/2/auto | `1` | reflects `data-cols`; `@container` grid |
| `animations` | bool | `false` | `--wz-dur` 0s→0.12s; gated by reduced-motion at render |

#### 3.1.4 Background tokens (`appearance.background`)

| Schema key | Type / enum | Default | Emits / effect |
|---|---|---|---|
| `type` | `FORM_BG_TYPES` = solid/gradient/image | `solid` | selects the composed page background |
| `gradientFrom` | hex, optional | — | gradient stop |
| `gradientTo` | hex, optional | — | gradient stop |
| `gradientDir` | `FORM_GRADIENT_DIRS` = to bottom/to top/to right/to bottom right/radial | `to bottom` | inert CSS gradient function |
| `imageUrl` | `httpsAssetUrl`, optional | — | SDK-built `url()` via `safeCssUrl` |
| `imageFit` | `FORM_BG_IMAGE_FITS` = cover/contain/repeat | `cover` | `--wz-page-bg-size` / `--wz-page-bg-repeat` |
| `scrim` | number 0–0.8 | `0` | `--wz-page-scrim` overlay (clamped ≥0.35 over an image for WCAG) |
| `cardBlur` | number 0–20 (px) | `0` | `--wz-card-blur`; frosted card gated by `data-card-blur` over an image only |

Composed CSS tokens emitted for the page area: `--wz-page-bg`, `--wz-page-bg-image`,
`--wz-page-bg-size`, `--wz-page-bg-repeat`, `--wz-page-scrim`, `--wz-page-pad`.

#### 3.1.5 Brand tokens

| Schema key | Type | Emits |
|---|---|---|
| `logo.url` | `httpsAssetUrl` (object optional) | `.rf-logo` `<img>` (max-height 56px) |
| `cover.url` | `httpsAssetUrl` (object optional) | `.rf-cover` `<img>` (max-height 180px, object-fit cover) |

#### 3.1.6 Motion & focus tokens (derived)

`--wz-dur` (0s / 0.12s / 0.01ms under reduced-motion), `--wz-ease`
(`cubic-bezier(0.4,0,0.2,1)`), `--wz-focus` (= primary or per-field accent),
`--wz-focus-width`.

#### 3.1.7 Complete emitted `--wz-*` variable list

`--wz-primary`, `--wz-primary-hover`, `--wz-bg`, `--wz-page-bg`, `--wz-surface`,
`--wz-subtle`, `--wz-fg`, `--wz-muted`, `--wz-border`, `--wz-error`, `--wz-btn-text`,
`--wz-radius`, `--wz-font`, `--wz-font-size`, `--wz-gap`, `--wz-pad-y`,
`--wz-pad-x`, `--wz-max-width`, `--wz-btn-radius`, `--wz-btn-align`,
`--wz-btn-pad-y`, `--wz-btn-font`, `--wz-card-pad`, `--wz-card-shadow`,
`--wz-card-border`, `--wz-focus`, `--wz-focus-width`, `--wz-dur`, `--wz-ease`,
`--wz-card-blur`, `--wz-page-bg-image`, `--wz-page-bg-size`, `--wz-page-bg-repeat`,
`--wz-page-scrim`, `--wz-page-pad`. Private token-flip vars used by variants:
`--_fill`, `--_bw`, `--_r`.

#### 3.1.8 Reflected host `data-*` attributes (complete)

Beyond the `--wz-*` custom properties, `form-renderer.ts` reflects appearance and
per-field state onto host / element `data-*` attributes in `updated()` (always
skipping the "today" default so an un-themed form emits none). The **complete**
set of reflected attributes shipped today — not only the appearance-driven ones —
is:

| Attribute | Driven by | Purpose |
|---|---|---|
| `data-label` | `layout.labelPosition` | top / left / floating label layout |
| `data-input` | `layout.inputVariant` | outlined / filled / underlined token-flip |
| `data-focus` | `layout.focusStyle` | ring / border / glow focus indicator |
| `data-cols` | `layout.columns` | 1 / 2 / auto `@container` grid |
| `data-card-blur` | `background.cardBlur` (over image) | frosted-card gate |
| `data-float` | floating-label runtime state | reflects whether a floating label is raised (has value / focused) |
| `data-near` | `showCounter` runtime state | counter has crossed the near-limit threshold (error color) |
| `data-on` | control runtime state | toggle/selected state on interactive controls |
| `data-width` | field `width` (`full` / `half`) | per-field width in the grid |
| `data-state` | SDK screen state | `ready` / `success` / `error` / `closed` ending / preview screen |
| `data-error-for` | field error binding | associates an inline error node with its field (a11y wiring) |
| `data-field` | field key | identifies the field wrapper for scoped styling / error targeting |

(The `data-ratio-forms-recaptcha` attribute on the injected reCAPTCHA `<script>` is
infrastructure, not an appearance reflection.) The `--wz-*` list in §3.1.7 plus this
table together are the full styling contract the SDK exposes.

> **Note on the umbrella draft vs. what shipped.** The earlier draft listed a
> generic "per-field accent" color token; it shipped as `field.style.accent`
> (per-field, §3.3), not a global color. `pageBackground` and `buttonAlign` were
> added to the delivered schema beyond the original THEMING-SPEC §1.2 list.

### 3.2 Field types — all 18 delivered

`FORM_FIELD_TYPES` (palette order): **text, textarea, email, phone, dropdown,
multi_select, date, file, radio, checkbox, number, url, rating, hidden**, plus the
4 non-collectable display/content blocks: **heading, divider, paragraph, image**.

`FORM_NON_COLLECTABLE_FIELD_TYPES` = `heading, divider, paragraph, image`;
`isCollectableFieldType()` gates required-check / data collection / the value
switch. Each type has: a discriminated-union member in `formFieldSchema`, a
`renderControl()` branch + client `validateField()` in `form-renderer.ts`, a server
branch in `schema-validator.service.ts` (for collectable types), and admin palette /
settings support.

Delivered per-type config (what actually ships today):

| Type | Delivered config keys | Server validation |
|---|---|---|
| text | `validation{pattern, minLength, maxLength}` | string, min/max length, regex |
| textarea | `validation{minLength, maxLength}` (default max 5000, hard cap 10000) | string, min/max length, cap |
| email | none | `EMAIL_RE` format |
| phone | none | `PHONE_RE` (+91 optional, 10 digits); normalized to `+91XXXXXXXXXX` |
| dropdown | `options` (≥1 non-empty) | membership |
| multi_select | `options` | array membership |
| date | none | `Date.parse` non-NaN |
| file | `validation{allowedMimeTypes, maxBytes}` (default all 4 MIME, 5 MB) | S3 key under merchant/form prefix, required-check |
| radio | `options` | membership |
| checkbox | `linkUrl?` (https), `linkText?` | boolean; required→must be true |
| number | `validation{min, max, step, integer}` | number, integer, min/max (step **not** server-enforced — see §4) |
| url | none | `new URL()` parse, http/https only |
| rating | `max` (int 3–10, default 5), `icon` (star/heart) | integer 1..max |
| hidden | `paramName` (URL param) | string, ≤2048 chars |
| heading | `text` (≤255), `level` (h2/h3) | display-only (skipped) |
| divider | none | display-only (skipped) |
| paragraph | `text` (≤2000, textContent) | display-only (skipped) |
| image | `url` (httpsAssetUrl), `alt?` | display-only (skipped) |

### 3.3 Per-field shared props (`baseFieldShape`)

Every collectable field carries: `key`, `label`, `placeholder?`, `required`,
`width` (`full`/`half`), plus the delivered enrichment props:

- **`style?`** — per-field override `{ inputVariant?, accent? (hex) }`. Applied
  scoped to that field's wrapper (`data-input` attr + inline `--wz-focus`/`--wz-primary`
  via `fieldAccent()`), never globally. Hex re-checked defensively at render.
- **`prefix?` / `suffix?`** (≤8 chars) — static flanking chips, text-only. Only on
  **adornable** types.
- **`helpText?`** (≤200) — `<p class="rf-help">` wired to `aria-describedby`.
- **`showCounter`** (bool) — live `used/limit` counter, shifts to error color near
  the limit; only meaningful with a `maxLength`.

**Adornment capability matrix** (`packages/shared/src/schemas/form-adornments.ts` —
Zod-free, the single source of truth consumed by both admin and SDK so they never
drift):
- `FORM_ADORNABLE_FIELD_TYPES` (prefix/suffix): **text, email, url, number**.
- `FORM_COUNTER_FIELD_TYPES` (counter): **text, textarea**.
- Helpers `isAdornable()`, `supportsCounter()`. Floating-label set derives from
  these two so it stays in lock-step.

Content blocks carry only `key` + `width` (`contentBlockBaseShape`), so the
uniqueness `superRefine` and half-width pairing treat them uniformly.

### 3.4 Preset themes — 6 delivered

`apps/admin-forms/src/lib/presets.ts` — each preset is a full `FormAppearance`
parsed through `appearanceSchema.parse()`, each WCAG-AA verified in `presets.test.ts`:

1. **Teal** — teal primary, light page, sm shadow.
2. **Midnight** — dark slate, cyan primary, md shadow, subtle top-to-bottom gradient.
3. **Minimal** — near-black primary, Inter, radius 4, no shadow, sharp buttons.
4. **Warm** — burnt-orange primary, Source Serif, cream surfaces, radius 14.
5. **High contrast** — pure black/white, black borders, no shadow.
6. **Ocean** — blue primary, filled inputs, diagonal light gradient.

Applying a preset swaps `colors/typography/layout/background` wholesale; the
merchant's `logo`/`cover` survive.

### 3.5 Admin Design tab

`apps/admin-forms/src/components/DesignSettings.tsx` — an Orion `<Card>` +
`PresetRow` (swatch buttons) + `<Collapse>` with panels:

- **Colors** — 9 `ColorPicker` (hex, showText), one per token, + inline
  **`ContrastReport`** (6 WCAG pairs: text/background, text/page, text/surface,
  muted/background, buttonText/primary at 4.5:1; border/background at 3:1).
- **Typography** — font-family `Select` (9 human-labelled), base-size `Slider` (12–20).
- **Layout** — radius `Slider`, density `Segmented`, max-width `Slider`, label
  position `Segmented`, columns `Segmented`, animations `Switch`, card-border
  `Switch`, shadow `Segmented`, advanced field-gap `Slider`, input-padding `Slider`.
- **Inputs** — input-style `Segmented`, focus-style `Segmented`, focus-width
  `Slider`, required-mark `Segmented`.
- **Buttons** — button-shape `Segmented`, button-size `Segmented`, button-icon
  `Select`, full-width `Switch`, alignment `Segmented` (disabled when full-width).
- **Background** — type `Segmented`; conditional gradient (2 `ColorPicker` + dir
  `Select`), image (`AssetInput` + fit `Segmented` + card-blur `Slider`), scrim
  `Slider` (shown when not solid).
- **Brand assets** — logo URL + cover URL `AssetInput`s.

Contrast math lives in `apps/admin-forms/src/lib/contrast.ts` (`parseHex`,
`linearize`, `relativeLuminance`, `contrastRatio`, `meetsContrast` — WebAIM
relative-luminance algorithm). State flows via a `updateAppearance` builder action
(deep-merge `AppearancePatch`) and is included in the form save payload.

### 3.6 WYSIWYG live preview

`apps/admin-forms/src/components/FormPreview.tsx` embeds the **real** `<ratio-form>`
element (side-effect import of `form-renderer?sdk`) in inline **preview mode**:
`previewSchema`, `previewAppearance`, `previewName`, `previewDescription`,
`previewSubmitLabel`, `previewSuccessMessage`, `previewState`. A `PreviewState`
`Segmented` (ready / success / error / closed) lets the merchant preview each SDK
screen. Submit runs client validation only; never POSTs. Mobile (375px) / Desktop
split retained. Because it is the same renderer, preview and embed cannot drift.

### 3.7 Migrations delivered

- **`0003_form_appearance.ts`** — adds nullable `appearance_json JSON` to `forms`
  (mirrors `schema_json`; existing rows keep SDK defaults). Reversible `down`.
- **`0004_form_metadata.ts`** — adds nullable `description varchar(500)` and
  `redirect_url varchar(2048)` to `forms`. Reversible `down`.

`0001_initial.ts` is frozen; `0002_export_jobs.ts` predates this PR. `db/types.ts`
is in lockstep. Service wiring: `forms.service.ts` stringifies `appearanceJson` on
create/update, copies it on duplicate, and parses it back via `parseAppearance`
(nullable twin of `parseSchema`). `submissions.service.ts` `getPublicSchema` parses
and serves `appearance` on the public read path.

### 3.8 Baseline admin screens (shipped in v1 — folded from `PRD.md`)

The enrichment adds the **Design** tab (§3.5) and the WYSIWYG preview (§3.6) on top
of the admin screens that already shipped in v1. Those baseline screens remain part
of the delivered product and are reproduced here so this umbrella is complete:

- **Forms list** (index) — table of the merchant's forms: name, status
  (active/inactive **toggle**), submission count, created date; row actions: edit,
  **duplicate**, **soft-delete** (with a warning when submissions exist or the form
  is placed on the storefront), **New Form**.
- **Form builder** (`/forms/:id/edit`) — the core editor: field palette (left) +
  canvas (right); drag to add and reorder (dnd-kit); per-field settings (label,
  placeholder, required, validation: regex / min-max length; phone = +91 prefix +
  10-digit; file = jpeg/png/webp/pdf ≤ 5 MB); form metadata (name, submit label,
  success message); spam-protection choice; notification email; webhook URL with a
  **Send test payload** button; side-by-side mobile/desktop preview; **Publish**. The
  **Design** tab (§3.5) is a peer tab on this screen.
- **Submissions** (`/forms/:id/submissions`) — paginated table sorted by date; a row
  **expands** to the full submission (file answers served via **7-day signed S3
  URLs**); **Export CSV** (full history); **per-submission webhook delivery status**
  with a **re-trigger** action for failed deliveries.
- **Config** — merchant-level settings: reCAPTCHA (shared Ratio key default,
  per-merchant **override**, **write-only secret** — GET returns `hasSecret`,
  threshold), default notification email (with a **bounce warning banner** driven by
  `forms_configs.email_bounced`), and the **kill switch** (`forms_enabled`).
- **Install / embed** — script-tag + iframe embed instructions per form
  (`ScriptTagPanel` pattern).

### 3.9 Baseline storefront SDK & public submission (shipped in v1 — folded from `PRD.md`)

`packages/forms-sdk` ships a Lit web component served per-merchant at
`/forms/sdk/:merchantId.js`. It fetches the form schema (no caching), renders
responsive fields, runs client-side validation, invisible reCAPTCHA v3, a honeypot
field, **disables submit after the first click**, POSTs to the public submission
endpoint, and shows the success message or inline errors. An inactive / deleted /
kill-switched form renders "This form is closed / no longer available / temporarily
unavailable." The enrichment renders through this **same** component (WYSIWYG, §2.4).

The public submission endpoint (`POST /forms/public/v1/forms/:formId/submissions`,
delivered on `PublicSubmissionsController`) is **public and unauthenticated** — the
first such endpoint in the repo. Its guard chain and parameters are detailed in §9.4.
(The original `PRD.md` named this `/forms/api/v1/...`; the shipped route is
`/forms/public/v1/...`.)

---

## 4. PLANNED — per-field enrichment

Source: `FIELD-ENRICHMENT-PLAN.md`. Every P0 row is reproduced with schema key, SDK
behavior, admin control, server-validation impact, and effort. P1/P2 rows follow per
field. Security envelope everywhere: enum / hex / https-asset / bounded-number /
bounded-string only. All keys land in `schema_json` (JSON column) → **no migration**
except the one hidden-field flag (§8).

### 4.1 text

| P | Enrichment | Schema key | SDK behavior | Server-validation impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Format preset library + custom error | `validation.format: enum(FORM_TEXT_FORMATS)`, `validation.patternMessage: string.max(120)` | resolve pattern from server-authored `FORM_TEXT_FORMAT_PATTERNS`, `RegExp(src,'u')`, reflect native `pattern=`, emit `patternMessage` on fail | server resolves same map + applies regex | `Select` (None/Letters/Alphanumeric/Slug/No-emoji/PIN/PAN/GSTIN/IFSC/Custom) + error-message `Input` | M |
| P0 | Value transform / normalize | `validation.transform: enum(none/trim/trim_upper/trim_lower/trim_title)` default `trim` | apply on blur (UX mirror) | **server authoritative**: applies before length/pattern, returns canonical value | `Select` "Clean up input" | M |
| P0 | `autocomplete` attribute | `autocomplete: enum(FORM_AUTOCOMPLETE_TOKENS)` | reflect native `autocomplete=` | none | `Select` "Autofill" | S |
| P0 | Native length attrs + hard ceiling | `FORM_TEXT_HARD_MAX_LENGTH=1000`; `validation.maxLength.max(1000)` | reflect `maxlength`/`minlength` | **server always enforces `min(maxLength, HARD_MAX)`** even when unconfigured | `max=` on existing Max-length input | S (ceiling is the security fix) |
| P1 | Input mask (`#`/`A`/`*`) | `validation.mask` | mask util format-on-input | server strips mask to canonical | mask input | M |

### 4.2 textarea

All hang off one nested `textareaDisplaySchema` (keeps the union member a plain object).

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Auto-grow + min/max rows | `display.{minRows, maxRows, autoGrow}` | `rows=minRows`, `field-sizing:content` + CSS clamp, graceful degrade | none | 2× `InputNumber` + `Switch` | M |
| P0 | Soft vs hard max length | `display.enforceMaxLength: bool` | add native `maxlength` when true | server already hard-enforces | `Switch` "Stop typing at max" | S |
| P0 | Counter unit (words) + min surfacing | `display.counterUnit: enum(characters/words)` | word-count in `renderCounter`; show `min N` when only minLength set | none | `Segmented` | S |
| P0 | Monospace | `display.monospace: bool` | `data-mono` → curated network-free mono stack | none | `Switch` | S |

### 4.3 email

New optional `validation` object (was none). Build order E1→E4→E3→E5.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Normalize + tighten + length cap + hints | `validation.maxLength.max(320)` default 254 | `trim().toLowerCase()`, tightened TLD regex, `autocomplete=email`/`autocapitalize=off`/`spellcheck=false` | **server returns canonical lowercased value** | (advanced) max-length input | S |
| P0 | "Did you mean" typo suggestion | `validation.suggestCorrections: bool` default true | client-only edit-distance vs curated `FORM_EMAIL_SUGGEST_DOMAINS/TLDS`; non-blocking "Apply" hint; no network | none | `Switch` | M |
| P0 | Free-provider block | `validation.blockFreeProviders: bool` | reject domain in curated `FORM_FREE_EMAIL_PROVIDERS` | **server-enforced** | `Switch` "Only business emails" | S |
| P0 | Domain allow/block list | `validation.allowedDomains[]` / `blockedDomains[]` (bare-hostname regex, mutually exclusive) | membership check post-normalize | **server-enforced** | `Segmented` None/Allow/Block + domain-row editor | M |
| P1 | Confirm-email field | (pairing behavior) | second input; equality check | server equality | Switch | M |

### 4.4 phone

Ship P0-1 + P0-2 as one unit; `+91`-only forms stay byte-identical. Table-driven; merchant picks enum only.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Multi-country dial-code selector | `allowedCountries: enum[]`, `defaultCountry: enum` default `IN` (+refine) | native `<select>` of `{flag}{dial}` when >1 country; submit composed E.164; single-country keeps static chip | **server rewrites `case 'phone'`: per-country validation** | `Select showSearch` (default) + `Select multiple` (allowed) | M |
| P0 | Per-country length + placeholder | (none — `PHONE_COUNTRY_META` table) | `maxlength`/placeholder/length-validation from curated table | server reads same table | (auto) | S |
| P1 | Extension / national-format mask / mobile-only | `allowExtension`, `mobileOnly` | mask + type check | server mirror | Switches | M |

### 4.5 dropdown

Keystone = the option-object refactor; unlocks description/group/emoji/image across dropdown + radio + multi_select.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Schema hardening | `optionsSchema`: `.max(MAX_OPTIONS=200)`, per-option `.max(200)`, dedupe `superRefine` | validation only | reject over-cap / dupes | surface errors | S |
| P0 | Option-object refactor + value≠label | `optionSchema = union(string, {label, value?, description?, group?, emoji?, image?})` | render `label`, submit `value` | **server membership → `optionValues()`** (coordinated one-liner across dropdown/radio/multi_select) | "Advanced values" per-row `Input` | M |
| P0 | Default option | `defaultValue: string` (+refine ∈ options) | seed `values[key]` at mount | none | `Select` | S |
| P0 | Bulk add/paste | (none) | none | none | `TextArea` split-on-newline, dedupe, cap | S |
| P0 | Searchable typeahead | `searchable: bool` | ARIA combobox over listbox when set; native `<select>` default | none | `Switch` | M–L |
| P1 | Option groups / descriptions / emoji / image | (option-object fields) | grouped `<optgroup>` / rich option render | server membership unchanged | options editor | M |
| P1 | "Other" free-text | `allowOther`, `otherLabel`, `otherMaxLength` | extra text input when "Other" picked | **server accepts ≤1 non-member value iff allowOther + within bound** | Switch + input | M |
| P1 | Placeholder / prompt | `prompt: string` | first disabled option | none | Input | S |

### 4.6 multi_select

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Min/max selection count | `selection: {min?, max?}` (refined) | count checks in validate; live "2 of 3" | **server-enforced** | 2× number `Input` | S |
| P0 | Server hardening | (none) | none | **reject `len > options(+1)`, dedupe crafted POSTs** | none | S |
| P0 | Display mode + columns | `display: enum(checklist/chips)`, `columns: int 1–3` | `data-cols` grid / chip toggles via tokens | none | 2× `Segmented` | M |
| P0 | Select-all / clear-all | `showSelectAll: bool` | leading control row; hidden when `max` set | none | `Switch` | S |
| P1 | "Other" + search + groups | option-object + `allowOther` | as dropdown | server "Other" relaxation | editor | M |

### 4.7 date

Tighten the loose `Date.parse` to `isoDateSchema` even in the minimal slice (correctness fix). Document "today" timezone.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Min/max + disable past/future | `validation.{min, max}: dateBoundSchema (mode none/today/fixed/offset)` | resolve bounds vs one "today" snapshot → native `min`/`max`; **lexicographic ISO compare** replaces loose `Date.parse` | **server re-resolves bounds**; tighten to `isoDateSchema` | `Segmented` bound-mode + `DatePicker`/offset input + disable-past/future `Switch`es | S–M |
| P0 | Default (today/fixed) | `defaultTo: enum(none/today)`, `defaultValue: isoDate` | seed once at init if empty | none | `Select` + `DatePicker` | S |
| P1 | Time / weekends / range (two dates) | `mode: date/datetime/range`, `disableWeekends` | native time / range render | server range validation | Segmented + Switch | M |

### 4.8 file

Multi-file (P0-4) is the one structural change — sequence it alone; it reshapes `files_json` (§8).

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Selected-file UI (name/size/remove) | (none) | chip row + Remove after input | none | none | S |
| P0 | Image preview | `showPreview: bool` default true | object-URL thumbnail for image mimes, revoke on clear/unmount | none | `Switch` | S |
| P0 | Drag-and-drop dropzone | (none) | `.rf-dropzone` + `data-dragover` token highlight; input stays click/a11y fallback | none | none | M |
| P0 | Multiple files + count | `FORM_FILE_MAX_COUNT=10`; `validation.{maxFiles, minFiles}` (refined) | `files: Record<key, string[]>`; `multiple`; loop presign per file | **reshapes `files_json`; submissions/webhook/CSV consumers union legacy string** | "Allow multiple" `Switch` + 2× `InputNumber` | L |
| P0 | Expand MIME allowlist | extend `FORM_FILE_ALLOWED_MIME_TYPES` (curated) | `accept=` auto-grows | validator allowlist grows | checkbox list auto-grows | S |
| P0 | Upload progress | (none) | switch `uploadFile` to XHR w/ `onprogress`; per-file bar; block submit until done | none | none | M |

### 4.9 radio

Add option-value uniqueness `superRefine` (P0 hardening, unblocks default/meta). Shares the option-object refactor.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Layout (vertical/horizontal/grid) | `layout: enum`, `gridColumns: int 2–4` | `data-layout` + bounded `--rf-cols` (self-set) | none | `Segmented` + column count | S |
| P0 | Visual variant (list/button/card) | `variant: enum` default `list` | keep real `<input>` for a11y, visually hide in non-list; `data-variant` + accent fill | none | `Segmented` | M |
| P1 | "Other" / per-option description / image / emoji / segmented | option-object + `allowOther` | rich render | server "Other" relaxation | editor | M |

### 4.10 checkbox

Both P0, no server/migration. `defaultChecked` + GDPR guardrail and export labels are P1.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Inline consent + `{link}` token | `consentText: string.max(500)` | splice `<a>` at `{link}` via text nodes beside box; suppress redundant top label, keep `aria-label` | none | `TextArea` + helper | S |
| P0 | Second/third policy link | `links: [{text, url(https)}].max(3)` | token-indexed `{link}`/`{link2}`/`{link3}` anchors | none | small repeater | S |
| P1 | Checkbox **group** (min/max) | reuse `selection {min?,max?}` | multi-box group | server count-check (shared with multi_select) | 2× input | M |
| P1 | Default-checked + GDPR guardrail | `defaultChecked: bool` | seed checked; warn in admin if required+default | none | Switch + warning | S |

### 4.11 number

`decimalPlaces` also delivers "N decimals" alone. Storage stays a JS number → CSV/webhook unchanged.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Server-side `step` enforcement | (none — **bug fix**) | (already client-side) | **mirror SDK step-multiple check on server** | none | S |
| P0 | Display formatting | `format: {style enum, currency enum, grouping bool, locale enum, decimalPlaces int 0–10}` (refined) | switch to `type=text`+`inputmode`; `Intl.NumberFormat` on blur, raw canonical on focus/submit; tabular-nums | **server strips group sep + enforces decimals** | Formatting divider: style/currency/locale `Select` + grouping `Switch` + decimals `InputNumber` + live preview | M |
| P1 | Slider variant + steppers + unit | `control: enum(input/slider)`, `unit: string`, `showSteppers` | range input / spinner / unit chip | none extra | Segmented + inputs | M |

### 4.12 url

New optional `validation` object (was none). Replace the static Alert with `UrlValidationSettings`. Ship the three as one PR.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Require HTTPS | `validation.requireHttps: bool` | `new URL()` parse + protocol check | **both sides check protocol** | `Switch` | S |
| P0 | Bounded maxLength | `validation.maxLength.max(2048)` default 2048 | `maxlength` attr + length check | **server length check** | number `Input` | S |
| P0 | Bare-domain normalize + autocomplete + placeholder | (behavior) | auto-prefix `https://` if schemeless, `autocomplete=url` | **both sides `new URL()` on normalized candidate → fixes drift; server returns normalized value** | helper caption | S/M |
| P1 | Domain allowlist + live preview | `validation.allowedDomains[]` (shared `domainSchema`) | membership + preview card | server membership | domain editor | M |

### 4.13 rating

E1+E2 = full Opinion-Scale / NPS capability; ship as a pair. Half-star is the second server-validation touch (P1).

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Low/High endpoint labels | `lowLabel` / `highLabel: string.max(48)` | text-node ends row + group `aria-label` | none | 2× `Input` | S |
| P0 | Numbered-button scale + 0-based min | `display: enum(icons/buttons)`, `min: int 0–1` default 1 | pill radios `min..max` | **server: `num < (field.min ?? 1)`; SDK mirror** — the one server change | `RadioGroup` display + "Start at" 1/0 | M |
| P1 | Half-stars / icon set / per-value labels / emoji / images | `allowHalf`, `icon enum(star/heart/thumb/number/emoji)`, `valueLabels[]` | half-fill render; curated icon map | **server accepts `.5` increments when allowHalf** | Segmented + editors | M |

### 4.14 hidden

The multi-source **provenance** work (§8) is the one item in the whole plan needing a migration.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Fallback / default | `fallback: string.max(2048)` | `value = resolved ?? fallback`; fixes required-hidden footgun | none | `Input` "Default value" | S |
| P0 | Multi-source resolution | `source: enum(url_param/cookie/referrer/landing_url/timestamp/constant)` default `url_param`, `paramName?`, `constantValue?`; consistency checks in **`formFieldsSchema.superRefine`** (union safety) | `resolveHiddenValue()` switch | **server hardens constant/timestamp** | `Select` (source) + conditional inputs | M |
| P0 | Admin cleanup | (none) | none | none | gate Placeholder/Advanced-style off for hidden | S |
| P1 | Value allowlist + normalize | `allowedValues[]`, `transform` | none | server membership / transform | editor | M |
| P1 | **Provenance context** (flagged) | server-captured `context_json` | none (server records referrer/timestamp/IP-derived context) | **needs `context_json` migration — the ONLY migration in the plan** | none | M |

### 4.15 Content blocks (heading / divider / paragraph / image)

Zero server-validation impact (blocks skipped by the submission validator; enforced
only at save-time union parse). Shared `FORM_BLOCK_ALIGNMENTS` underpins three.

| P | Enrichment | Schema key | SDK behavior | Server impact | Admin control | Effort |
|---|---|---|---|---|---|---|
| P0 | Image align + size + caption + link | `align enum`, `size enum`, `caption str`, `linkUrl https` | `<figure data-align data-size>` + `<figcaption>` + guarded `<a>` (re-check `https://`) | none (save-time union only) | `Segmented`×2 + `Input`×2 | M |
| P0 | Heading align + size + eyebrow | `size enum`, `align enum`, `eyebrow str.max(80)` | decouple visual size from semantic `level`; `data-*` token map | none | `Segmented`×2 + `Input` | S |
| P0 | Paragraph alignment | `align enum` | `data-align` → `text-align` | none | `Segmented` | S |
| P0 | Divider variants | `variant enum(line/dashed/dotted/spacer)`, `spacing int 0–80` | `data-variant` border-style / spacer height | none | `Segmented` + `InputNumber` | S |
| P1 | Paragraph markdown-lite (bold/italic/link) | `markdown: bool` | safe subset → text nodes + guarded `<a>` (never innerHTML) | none | Switch | M |

---

## 5. PLANNED — theming / visual enrichment

Source: `THEMING-SECTION-CATALOG.md` (12 sections). Every P0/P1/P2 row reproduced.
Security + no-migration invariants as §2. `appearanceSchema` is `.strict()` so every
new global key must be declared. The two accessibility **defects** to fix
(fieldset/legend, autofill) are called out inline (§5.3 item 7, §5.4 item I1).

### 5.1 Color system

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | C1 | Brand → native controls + selection | (none) `--wz-accent`, `--wz-selection` | `:host{accent-color}` + `::selection` | auto | S |
| P0 | C2 | Tokenize per-state colors | `--wz-primary-active/-soft/-border`, `--wz-disabled-bg/-fg`, `--wz-error-bg/-ring` | promote inline `color-mix` to named tokens | none | S-M |
| P0 | C3 | First-class `success` (+`warning`/`info`) | `colors.success/warning/info` optional | `--wz-success`, `--wz-success-bg/-border`, auto `--wz-on-success` | 3 optional ColorPickers | S |
| P0 | C4 | Placeholder + link + label tokens | `colors.link` optional; placeholder derived | `--wz-placeholder`, `--wz-link` + underline | Link ColorPicker | S |
| P1 | C5 | Alpha/opacity authoring | `colors.borderAlpha/surfaceAlpha` 0–1 | `color-mix` % feed; enable alpha in picker | alpha slider + 2 Sliders | S |
| P1 | C6 | Palette generation from one hex | `colors.seed` optional (provenance) | none (admin emits hex) | ColorPicker + Generate | M |
| P1 | C7 | Contrast auto-fix + APCA readout | (none) | extend `contrast.ts` w/ APCA `Lc` | per-row Fix button + APCA column | M |
| P1 | C8 | Dark mode as 2nd set | `colorMode` enum, `colorsDark` optional | emit dark block (`@media prefers-color-scheme` for auto) | Segmented + dark palette tab | M-L |
| P1 | C9 | Gradient button/accent fill | `buttonFill`, `buttonGradientFrom/To/Dir` | inert `linear-gradient` → `--wz-btn-bg` | Segmented + 2 pickers + dir | M |
| P1 | C10 | Explicit per-state overrides | `primaryHover/Active`, `disabledBg/Text` optional | override C2 fallback when present | Advanced collapse, 4 pickers | S-M |
| P2 | C11 | Harmony accent suggestions | (writes `link`/`success`/accent) | none | swatch buttons | M |
| P2 | C12 | Tonal scale for primary | (none) `--wz-primary-1/6/9/11` | stepped `color-mix` for chips/selected | auto | M-L |
| P2 | C13 | Per-field accent gradient/tint | `field.style.accentFrom/To` | scoped inline `--wz-*` via `fieldAccent()` | field Advanced style | M |
| — | C14 | Reject/defer: animated gradients, raw color functions, full per-state matrix, runtime relative-color | — | — | — | — |

### 5.2 Typography

**Prerequisite refactor (P0 backbone):** replace `calc(var(--wz-font-size) ± Npx)`
element sizes with `--wz-fs-*` role tokens computed in `themeVars()`; defaults
reproduce today's 16/18/20.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | T1 | Font pairing (heading/body) | `headingFont`, `bodyFont` optional | `--wz-font-heading/-body`; inject ≤2 links | 2 Selects | S |
| P0 | T2 | Ratio type-scale | `scaleRatio` enum (`FORM_TYPE_SCALES`) | compute `--wz-fs-title/-h2/-h3` from `base·rⁿ` | Segmented/Select | M |
| P0 | T3 | Weight tokens per role | `headingWeight/labelWeight/bodyWeight` enum | `--wz-weight-*`; **widen `GOOGLE_FONT_HREF` axes** | 3 Segmented | M |
| P0 | T4 | Line-height (body+heading) | `bodyLineHeight` 1.1–2.0, `headingLineHeight` 1.0–1.6 | `--wz-lh-body/-heading` | 2 Sliders | S |
| P1 | T5 | Letter-spacing / tracking | `headingTracking`, `bodyTracking` (em) | `--wz-track-heading/-body` | 2 Sliders | S |
| P1 | T6 | Text transform / case | `labelCase/buttonCase/headingCase` enum | `text-transform`; DOM text unchanged | 3 Segmented | S |
| P1 | T7 | Per-element sizing | `titleScale/labelScale/inputScale/helpScale` optional | multiply base, clamp ≥12/16px | Advanced sizing group | M |
| P1 | T8 | Expanded library + pairing presets | add families; `FORM_TYPE_PAIRINGS` | new `GOOGLE_FONT_HREF`/`FONT_STACKS` entries | grouped Select + pairing row | S |
| P1 | T9 | Fluid headings | `fluidHeadings` bool | `clamp()` on `cqi` | Switch | M |
| P2 | T10–T16 | Variable-font axis; smoothing toggle; content-block type controls; per-field label type; `font-display`; numeric glyphs; link decoration | various optional | mostly enum/bool | small controls | S–L |

### 5.3 Layout & spacing

> **Accessibility defect (fieldset/legend):** item 7 carries the radio/checkbox
> `<fieldset>/<legend>` grouping fix — a real WCAG 1.3.1 / 4.1.2 defect. **Ship it
> independently of the `section` block.**

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | 1 | 3-col + per-field span | `columns`+`'3'`, field `span` | `data-cols='3'`, `grid-column: span --_span` | Segmented + per-field Select | M |
| P0 | 2 | Input padX + card inset | `inputPadX`, `cardPadding` | `--wz-pad-x`, `--wz-card-pad` (fixes override bug) | 2 Sliders | S |
| P0 | 3 | Column gutter vs row gap | `columnGap` | `--wz-col-gap`; split row-gap/column-gap | Slider | S |
| P0 | 4 | Content/heading alignment | `contentAlign` enum | `data-align` on title/desc/heading/logo | Segmented | S |
| P0 | 5 | Card vs flat + fluid width | `layoutMode`, `fluidWidth` | `data-layout='flat'`, `--wz-max-width:none` | Segmented + Switch | S-M |
| P1 | 6 | Whitespace scale multiplier | `spacingScale` 0.75–1.5 | scales gap/padY/cardPad; document precedence | Slider | M |
| P1 | 7 | Section block + **group a11y fix** | `section` block type | `role=group` / `<fieldset><legend>` | palette item + props | M-L |
| P1 | 8 | Vertical rhythm above sections | `sectionGap` | `--wz-section-gap` margin-top | Slider | S |
| P1 | 9 | Label gap + label-left width | `labelGap`, `labelWidth` | `--wz-label-gap`, `--wz-label-width` | 2 Sliders | S |
| P1 | 10 | Responsive stack breakpoint | `stackBreakpoint` enum | `data-stack`; discrete `@container` blocks | Segmented | S-M |
| P1 | 11 | Auto-column min-width | `autoMinWidth` rem | `--wz-auto-min` | Slider | S |
| P2 | 12 | Card alignment in page | `cardAlign` enum | `--wz-card-margin` | Segmented | S |
| P2 | 13 | Logo/cover placement + bleed | `logoAlign`, `coverBleed` | `data-logo-align`, negative margins | Segmented + Switch | S-M |
| — | 14 | Defer: multi-step page engine (structural) | — | — | — | L |

### 5.4 Inputs

> **Accessibility defect (autofill):** item **I1** is the browser-autofill styling
> fix — today `:-webkit-autofill` paints a hard-coded white/yellow box that breaks
> dark & filled themes. **P0.**

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| **P0** | **I1** | **Autofill styling fix** (breaks dark/filled today) | (none) | `:-webkit-autofill` box-shadow inset + `text-fill-color` reading `--_fill` | none | S |
| P1 | I2 | Input size + touch min-height | `inputSize` enum | `--wz-input-min-h` (34/40/48) orthogonal to density | Segmented | S/M |
| P1 | I3 | Placeholder color | `colors.placeholder` (defaults to muted) | `::placeholder{color; opacity:1}` | ColorPicker + contrast pair | S |
| P1 | I4 | Leading/trailing icons | field `prefixIcon/suffixIcon` enum | curated `INPUT_ICONS` SVG inside field | 2 Selects | M |
| P1 | I5 | Inline validation timing | `validateOnBlur` bool | `@blur` validate → escalate to `@input`; `aria-live` | Switch | M |
| P1 | I6 | Autocomplete/inputmode | derived + optional enum | set attrs per type | optional Select | S |
| P2 | I7 | Selection + caret color | (derive from primary) | `::selection`, `caret-color` | none | S |
| P2 | I8 | Disabled tokens + submit-lock | (none) | `?disabled` all controls during submit; `--wz-disabled-*` | none | S/M |
| P2 | I9 | Per-field readonly (blocked on prefill) | `field.readOnly` | `readonly` + `--wz-readonly-bg` | Switch | M |
| P2 | I10 | Hidden label | `labelPosition`+`'hidden'` | sr-only label | Segmented option | S |
| P2 | I11 | Success/valid state | `colors.success` | `[data-valid]` border + check | — | M |
| P2 | I12 | `soft`/`ghost` variants | extend `FORM_INPUT_VARIANTS` | 2 token-flip blocks | Select | S |
| P2 | I13 | Inline adornment style | `adornStyle` enum | seamless in-border affix | — | M |
| P2 | I14 | Error message icon | (curated SVG) | ⚠ before `.rf-error` | — | S |
| P2 | I15 | Custom select chevron | (SDK data-URI) | `appearance:none` + SVG bg | — | M |
| P2 | I16 | Textarea rows/resize/align | `rows`, `resize`, `textAlign` | attrs/CSS | — | S |
| P2 | I17 | Floating-label hardening | (none) | contrast-check floated label; copy nudge | — | S |

### 5.5 Buttons

> **Accessibility defect (loading focus):** item **B2** fixes an a11y bug — today's
> `?disabled` on submit **drops focus**; replace with `aria-disabled` + `aria-busy`
> + live region + reduced-motion spinner. **P0.**

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | B1 | Variant solid/outline/ghost/soft | `buttonVariant` enum | `data-btn-variant` token-flip | Segmented | S |
| **P0** | **B2** | **Loading spinner + `aria-busy`** (fixes focus-drop bug) | `buttonLoader` enum | `aria-disabled`+`aria-busy`+live region; reduced-motion spinner | Segmented | S/M |
| P0 | B3 | Touch min-height 44px | (none, opt `buttonMinHeight`) | `min-height:44px` | none | S |
| P1 | B4 | Icon pos + glyphs | `buttonIconPos` enum; grow `FORM_BUTTON_ICONS` | leading/trailing render | Segmented | S/M |
| P1 | B5 | Button typography | `buttonWeight/Transform/Tracking` | `--wz-btn-weight/-transform/-tracking` | Segmented/Slider | S |
| P1 | B6 | Gradient fill | `buttonFill`, gradient keys | inert gradient → `--wz-btn-bg-image` | conditional pickers | M |
| P1 | B7 | Shadow/elevation | `buttonShadow` (reuse `FORM_SHADOWS`) | `--wz-btn-shadow` | Segmented | S |
| P1 | B8 | Hover effect | `buttonHover` enum | `data-btn-hover`; gated by `--wz-dur` | Select | S/M |
| P1 | B9 | Explicit button color tokens | `colors.buttonBg/HoverBg/Border` optional | prefer when set, else primary/derived | 3 ColorPickers | S |
| P1 | B10 | Focus parity on button | (reuse `focusStyle`) | add `.rf-submit` to `data-focus` selectors | none | S |
| P1 | B11 | Disabled opacity | `buttonDisabledOpacity` 0.3–0.8 | `--wz-btn-disabled-opacity` | Slider | S |
| P2 | B12 | Multi-step nav (Back/Next) | `nav*` keys | `.rf-nav` split; **gated on pages engine** | conditional panel | L |
| P2 | B13–B16 | Icon-only; width bounds; reset (decline); per-state hover color | various | — | — | S |

### 5.6 Background & surface

Structural addition unlocking several items: a dedicated `.rf-bg` image layer
(`position:absolute;inset:0;z-index:-1`) so filters/patterns never touch card/content.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | E1a | Card position | `cardPosition` enum | `data-card-pos`; margin/full-bleed | Segmented | S/M |
| P0 | E1b | Image brightness/blur/grayscale | `imageBrightness/Blur/Grayscale` | `filter` on `.rf-bg` layer | 3 Sliders | M |
| P0 | E2a | Shadow scale → lg/xl | extend `FORM_SHADOWS` | 2 `SHADOWS` map entries | Segmented | S |
| P1 | E3 | Background patterns | `type`+`'pattern'`, `pattern*` keys | SDK-built SVG `data:` URI from enum+hex | Select + picker + sliders | M |
| P1 | E4 | Colored scrim tint | `scrimColor` optional | `scrimLayer()` uses hex | ColorPicker | S |
| P1 | E5 | Image focal position | `imagePosition` enum | `--wz-page-bg-position` | 9-dot/Select | S |
| P1 | E6 | Full-page fill + vcenter | `pageFill` enum | `data-page-fill`; `100dvh` flex | Switch | M |
| P1 | E7 | Card border width+color | `cardBorderWidth`, `cardBorderColor` | `--wz-card-border` composite | Slider + picker | S |
| P1 | E8 | Decouple card radius | `cardRadius` optional | `--wz-card-radius` | Slider | S |
| P2 | E9 | Split-screen panes | `cardPosition`+split / `splitImage` | 2-col grid, `@container` collapse | segments + AssetInput | L |
| P2 | E10 | Section backgrounds | `section` block (`bg/radius/padded`) | scoped `.rf-section` | palette item | L |
| P2 | E11 | Noise/grain | `noise` 0–0.25 | `feTurbulence` SVG overlay | Slider | M |
| P2 | E12 | Vignette/directional scrim | `scrimShape` enum | radial/linear gradient | Segmented | M |
| P2 | E13 | Per-corner radius | `cardRadiusCorners` | 4-value shorthand | InputNumber cluster | M |
| P2 | E14 | Tinted shadow (M3) | `shadowTint` enum | `color-mix` shadow | Segmented | M |
| P2 | E15 | Card surface gradient | `cardGradientTo/Dir` | `--wz-bg` gradient (+solid fallback) | picker + Select | M |
| P2 | E16 | Bg attachment fixed | `bgAttachment` enum | `background-attachment` | Switch | S |
| P2 | E17 | Frosted saturate refine | (none) | add `saturate/brightness` to blur | — | S |

### 5.7 Presets & themes (almost all admin-only, zero SDK/schema)

| P | ID | Enrichment | Schema/SDK? | Behavior | Admin | Effort |
|---|----|-----------|-------------|----------|-------|--------|
| P0 | 1 | Expand library 6→~20 + categories | No/No | TS-only `category`/`industries` on `AppearancePreset` | category tabs + search | M |
| P0 | 2 | Live preview thumbnails | No/No | mini-card via `themeVars(preset.appearance)` | replace 3-dot swatch | S |
| P0 | 3 | Theme export/import JSON | No*/No | wire format = `appearanceSchema`; admin `themeFileSchema` envelope | Export btn + Upload | S |
| P0 | 4 | Per-industry starters | No/No | `industries` tag + filter | Select filter | S |
| P1 | 5 | Brand-kit from logo (client-side) | No/No | canvas quantize → hex + AA post-pass | Generate button | M |
| P1 | 6 | Light/dark preset pairing | No/No | `dark?: FormAppearance` on preset | light/dark toggle | S |
| P1 | 7 | "Save as theme" (My Themes) | No†/No | localStorage v1 → account JSON | Save + My-themes row | M |
| P1 | 8 | Granular apply (colors-only/full) | No/No | partial `AppearancePatch` | Segmented apply mode | S |
| P1 | 9 | Source-color generator | No/No | HCT/HSL util (admin) + AA pass | picker + Generate | M |
| P2 | 10 | First-class SDK dark mode | **Yes/Yes** | `colorScheme` enum + `colorsDark`; `data-scheme` + `@media` | Segmented + dark group | L |
| P2 | 11 | Account Brand Kit | †storage/No | #5+#7 promoted, account-scoped | — | L |
| P2 | 12 | AI theme-from-prompt | No/No | LLM → hex/enum → AA pass | prompt input | M |
| P2 | 13 | Preset `presetId` stamp | tiny Yes/No | `presetId` bounded string | — | S |

### 5.8 Focus & motion

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin | Effort |
|---|----|-----------|--------------------|--------------|-------|--------|
| P0 | E1 | Focus offset token | `focusOffset` 0–6 | `--wz-focus-offset` replaces literal 2px | Slider | S |
| P0 | E2 | Unify glow/error/rating focus + ring-contrast | (opt `focusGlowSize`) | `--wz-focus-ring/-glow`; add focus pair to `ContrastReport` | opt Slider | S |
| P0 | E3 | Motion speed scale | `motionSpeed` enum | `--wz-dur-fast/base/slow` (replaces binary) | Segmented | S/M |
| P0 | E4 | Easing preset enum | `easing` enum | map → fixed cubic-beziers | Segmented | S |
| P0 | E5 | Submit spinner | `submitLoader` enum | `.rf-spinner`; reduced-motion fallback | Segmented | S |
| P1 | E6 | Entrance animation (stagger) | `entrance` enum | `data-entrance`; `animation-delay: calc(--i*40ms)` | Segmented | M |
| P1 | E7 | Hover lift | `hoverLift` bool | `--wz-btn-lift` transform+shadow | Switch | S/M |
| P1 | E8 | Loading skeleton | `loadingStyle` enum | shimmer bars; freeze on reduced-motion | Segmented | M |
| P1 | E9 | Success checkmark | `successAnimation` enum | SVG `stroke-dashoffset` draw | Segmented | M |
| P1 | E10 | `underline` focus style | extend `FORM_FOCUS_STYLES` | animated bottom-border | Segmented option | S |
| P1 | E11 | Dedicated focus color | `colors.focus` optional | `--wz-focus` override | ColorPicker | S |
| P1 | E12 | **Reduced-motion degrade-not-nuke** | (none) | targeted end-state rules, not blanket kill | — | S |
| P2 | E13–E16 | Confetti; scroll-reveal (IO, bundle cost); per-field entrance; tokenize press | various | — | — | S-M/L |

### 5.9 Ending states

Storage: new `appearance.endings` object (content + behavior nest here since
`successMessage`/`redirectUrl` are scalar columns). Backward-compat chain
`endings.success.body ?? successMessage ?? default`.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin | Effort |
|---|----|-----------|--------------------|--------------|-------|--------|
| P0 | E1 | Structured panel (icon+heading+body) | `endings.icon/heading` | `.rf-ending` `role=status aria-live`; focus move | Ending panel | M |
| P0 | E2 | Per-state custom copy | `endings.{closed,expired,unavailable,error}` | fallback to today's strings | state picker editor | S-M |
| P0 | E3 | Per-state semantic tokens | (derived + opt `successAccent`) | `--wz-ending-accent` via `data-state` | opt picker | S |
| P0/P1 | E4 | Redirect delay + countdown | `redirectDelaySeconds`, `showRedirectCountdown` | replace `REDIRECT_DELAY_MS`; "Go now" link | Slider + Switch | S-M |
| P1 | E5 | Submit-another (resubmit) | `endings.resubmit` | reset state to `ready` | Switch + Input | M |
| P1 | E6 | Ending action CTA | `endings.action` (https) | `<a>` styled as submit | Input + Select | S-M |
| P1 | E7 | Custom ending imagery | `endings.imageUrl` | `<img>` above panel | AssetInput | S |
| P1 | E8 | Share buttons | `endings.share` | SDK-built intent URLs from `location.href` | Switch + multi-Select | M |
| P1 | E9 | Ending alignment | `endings.align` enum | `data-ending-align` | Segmented | S |
| P1 | E16 | Error/rate-limit themed retry | `endings.error`, `showRetry` | themed panel + Try-again preserving values | Switch | S |
| P1/P2 | E10 | Ending entrance animation | (reuse `layout.animations`) | draw/fade gated | (existing switch) | M |
| P2 | E11 | Distinct `expired` state | `endings.expired` + backend reason | new Status/PreviewState | preview states | M |
| P2 | E17 | Loading/submitting polish | (opt `loadingText`) | themed spinner + `aria-busy` | — | S |
| P2 | E12–E15 | Defer: conditional endings (logic engine); answer recall/piping; email/edit/PDF (backend); confetti | various | — | — | M-L |

### 5.10 Branding

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin | Effort |
|---|----|-----------|--------------------|--------------|-------|--------|
| P0 | B1 | Logo size/align/max-height | `logo.size/align/maxHeight` | `--wz-logo-height/-align` | Segmented×2 (+Slider) | S |
| P0 | B2 | Logo alt text | `logo.alt` | `alt` attr (default `""`) | Input | S |
| P1 | B3 | Cover overlay/height/focal/blur | `cover.height/position/overlay/overlayOpacity/blur/alt` | `--wz-cover-*`; `::after` overlay | Sliders + picker + Segmented | M |
| P1 | B4 | "Powered by" show/hide | `branding.showPoweredBy` (server-clamped by plan) | static footer link (hardcoded target) | Switch | S |
| P1 | B5 | Favicon (**hosted route only**) | `favicon.url` | `<link rel=icon>` on hosted page; **embed ignores** | AssetInput | S |
| P1 | B6 | Footer/legal text + ≤3 links | `footer.text/links` | `.rf-footer` via `textContent`; `<footer>` | TextArea + repeater | M |
| P1 | B7 | Accent propagation + secondary | (derived) `--wz-primary-subtle/-contrast`; `colors.secondary` | consistent roles + optional 2nd color | opt ColorPicker | M |
| P2 | B8 | Header hero mode | `headerStyle` enum | `data-header='hero'`; needs B3 overlay | Segmented | M |
| P2 | B9–B11 | Logo shape/frame; logo link; social/OG (**hosted only**) | `logo.logoShape/linkUrl`; `share` | — | — | S/M |
| P2 | B12–B13 | Fold-in/out: watermark (use bg image); account brand-kit (separate entity) | — | — | — | M/L |

> Extend `applyPreset()` preserve-rule so `branding`, `favicon`, `footer`, `share`
> survive preset swaps (as `logo`/`cover` already do).

### 5.11 Accessibility

New `appearance.a11y` object (one `.strict()` addition) + top-level `dir`/`lang`.
Items marked *(renderer-only)* need no schema and are always-on correctness fixes.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin | Effort |
|---|----|-----------|--------------------|--------------|-------|--------|
| P0 | A1 | Live-region state/error announce *(renderer)* | (none) | `role=status/alert`, `aria-live`, `aria-busy` | none | S |
| P0 | A2 | Focus mgmt + error summary *(renderer)* | (opt `errorSummary`) | focus first invalid; summary block | none | S/M |
| P0 | A3 | Group semantics + names *(renderer)* | (none) | `role=group`/`fieldset`, `aria-labelledby`, `aria-required` | none | S |
| P0 | A4 | `aria-required`/autocomplete/landmark name *(renderer)* | (none) | attrs + `aria-label` on form | none | S |
| P0 | A5 | Non-color cues (underline links + error icon) | `a11y.underlineLinks/errorIcon` | underline + ⚠ SVG | 2 Switches | S |
| P0 | A6 | Harden `.rf-sr` *(renderer)* | (none) | robust visually-hidden recipe | none | S |
| P0/P1 | A7 | Contrast engine: AA/AAA, large-text, focus/scrim pairs, **auto-fix** | `a11y.contrastLevel/contrastPolicy` | extend `contrast.ts` (+APCA readout, not gate) | 2 Segmented + Fix button | M |
| P0/P1 | A8 | Forced-colors support *(renderer)* | (none) | `@media forced-colors`; outline fallback for glow/border | none | M |
| P1 | A9 | Target-size floor | `a11y.targetSize` enum | `--wz-tap-min` 24/44 | Segmented | M |
| P1 | A10 | RTL (`dir`) + logical props | top-level `dir` enum | reflect `dir`; migrate physical→logical CSS | Segmented | M |
| P1 | A11 | Content language | top-level `lang` enum | reflect `lang` (+string catalog) | Select | S/M |
| P1 | A12 | High-contrast boost | `a11y.highContrast` | `@media prefers-contrast` bumps | Switch | S |
| P1 | A13 | Universal `:focus-visible` *(renderer)* | (reuse tokens) | extend to all interactive els | none | S |
| P1 | A14 | Accessible live counter *(renderer)* | (toggled by `showCounter`) | drop `aria-hidden`; polite threshold announce | none | S |
| P1 | A15 | Text-spacing/line-height | `a11y.lineHeight` | `--wz-line-height`; audit clip | Slider | S |
| P2 | A16–A19 | Reduced-transparency; required legend; auto-dark; `aria-busy` submit | various | — | — | S/M-L |

### 5.12 Responsive container

New `appearance.responsive` object. **R1 is a prerequisite** for R4/R5/R12 and R7 correctness.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin | Effort |
|---|----|-----------|--------------------|--------------|-------|--------|
| P0 | R1 | **CQ anchor fix**: `container-type` on card, named | (none) | move to `.rf-cq`; name `@container wz` | none | S |
| P0 | R2 | Mobile full-bleed vs inset | `responsive.mobileLayout` | `data-mobile='bleed'` + safe-area | Segmented | M |
| P0 | R3 | Touch-target floor | `responsive.touchTargets` enum | `--wz-tap-min`; `@media pointer:coarse` | Segmented | S |
| P0 | R4 | Container gutter (`vw`→`cqi`) | `responsive.pagePadding` opt | `clamp(24px,6cqi,72px)` | Slider | S |
| P1 | R5 | Fluid typography (`cqi` clamp) | `responsive.fluidType` bool | `clamp` on `--wz-font-size` | Switch | M |
| P1 | R6 | Adaptive density | `responsive.adaptiveDensity` bool | narrow `@container` density step | Switch | M |
| P1 | R7 | Stack breakpoint (enum) | `responsive.stackBreakpoint` enum | `data-stack`; can't read vars in `@container` | Segmented | M |
| P1 | R8 | Embed auto-resize height | SDK attr / opt `maxEmbedHeight` | `ResizeObserver`+`postMessage` (**origin-pinned**) | embed-flow toggle | M/L |
| P1 | R9 | Tiny-container overflow hardening *(render)* | (none) | shrink flanked input; rating wrap; `overflow-x:clip` | none | S |
| P1 | R10 | Width mode fixed/fluid | `responsive.widthMode` enum | `data-width-mode` | Segmented | S |
| P2 | R11–R13 | Sticky submit; responsive cover/logo `cqi`; auto-fit col min | various | — | — | S/M |
| — | R14 | Reject/defer: height CQs, scroll-state, orientation, print, JS font-resize (superseded by R5) | — | — | — | — |

---

## 6. Cross-cutting reusables (build once, consume everywhere)

Two families of shared primitives, both recurring across ≥3 field or theming specs.
Building them once eliminates duplication, keeps the widget small, and is the enabler
for non-colliding parallel field work.

### 6.1 Field-domain reusables

| # | Reusable | Consumed by | Notes |
|---|---|---|---|
| A | **Option-object model + normalizer** | dropdown, radio, multi_select | `optionSchema = union(string, {label,value?,description?,group?,emoji?,image?})`; `resolveOption()`/`optionValues()` (Zod-free, SDK-importable). Forces the one coordinated server one-liner `includes(value)` → `optionValues().includes(value)`. Backward-compatible union. **The keystone; its own workstream.** |
| B | **Shared "Other" free-text option** | dropdown, radio, multi_select, checkbox | `allowOther`, `otherLabel`, bounded `otherMaxLength`. The only pattern that loosens the closed-set guarantee — the server membership relaxation (accept ≤1 non-member value iff allowOther + within bound) built once. |
| C | **Min/max selection** | multi_select, checkbox-group | one `{min?,max?}` refined sub-schema + one count-check helper (client + server). |
| D | **Options editor + bulk-paste** | dropdown, radio, multi_select (+ email/url list editors) | one antd component (label/value/description/emoji/image/group per row) + bulk-paste (newline-split, dedupe, cap). Replaces three divergent `OptionsEditor` forks. |
| E | **Value transform / normalization library** | text, email, url, hidden, phone, number | one shared **pure** helper (Zod-free), imported by SDK + server so verdicts never drift. Fixes the recurring client/server divergence bug. |
| F | **Format/mask utility** | text presets, text mask, phone grouping, number Intl | one mask→regex + one "format-on-blur / raw-on-focus" helper; derive from server-authored specs; `u` flag; strip to canonical before persist. |
| G | **Curated autocomplete / input-hint tokens** | text, email, url (+ phone/number) | `FORM_AUTOCOMPLETE_TOKENS`, `inputMode`/`spellcheck`/`autocapitalize` enums on `baseFieldShape`. |
| H | **Bounded domain-token schema** | email allow/block, url allowlist | one `domainSchema` (bare-hostname, no scheme/path) + `matchesDomain(host, list)` (wildcard-aware), both sides. |
| I | **Shared https-anchor render helper** | checkbox links, image-block link, url preview, paragraph markdown-lite | safe `<a target=_blank rel=noopener noreferrer>` with defensive `^https:` re-check. Eliminates four copies. |
| J | **`data-*` → private-token CSS convention** | radio layout/variant, multi_select display/columns, block align/size, divider, rating size | merchant enum → `data-*` attr → private `--wz-*` token; never a raw CSS string. The security backbone. |
| K | **Hard length/array ceilings** | text, url, options, multi_select, file | uniform always-on server ceiling even when unconfigured; one hardening pass. |

### 6.2 Theming-domain reusables

| # | Reusable | Consumed by |
|---|---|---|
| 1 | **Elevation / shadow scale** — one `SHADOWS` map (none/sm/md/lg/xl + tinted) | background (E2a/E14), buttons (B7), cards. One `FORM_SHADOWS` enum. |
| 2 | **Per-state color engine** — `--wz-primary-hover/-active/-soft/-border`, `--wz-disabled-*`, `--wz-error-bg/-ring`, `--wz-success*`, `--wz-on-*` | inputs (I8/I11), buttons (B1/B9), endings (E3), focus/motion (error ring). Derivation table in `themeVars()` once; explicit overrides (C10) layer on top. |
| 3 | **Motion token set** — `--wz-dur-fast/base/slow`, `--wz-ease/-out` + refined reduced-motion contract (degrade to end-state) | focus/motion (all), buttons (B2/B8), inputs (I5), endings (E10), background transitions. |
| 4 | **Contrast / palette utility** — `meetsContrast(fg,bg,{level,large})` AA/AAA + large-text + non-text (3:1) + scrim-aware + APCA `Lc` readout; AA auto-fix / OKLCH-HCT derivation (admin-only) | color (C6/C7), presets (#5/#9/#12), branding (B7), a11y (A7), dark sets (C8/A18). Extend `contrast.ts` + `ContrastReport` in place. |
| 5 | **Focus-indicator token group** — `--wz-focus`, `-width`, `-offset`, `-ring`, `-glow` + forced-colors outline fallback | inputs, buttons (B10), rating, links, error-summary. Unifies E2/A8/A13. |
| 6 | **Curated inline-SVG icon maps** — enum → SVG template, `currentColor`, `aria-hidden` (the proven `BUTTON_ICONS` pattern) | input icons (I4), ending icons (E1/E2), error/success glyphs (I14/E9), spinner (B2/E5), share (E8), select chevron (I15), patterns/noise (E3/E11 as `data:` URIs). |
| 7 | **`data-*` host-attribute reflection helper** — the `reflectAttr` in `updated()` | every layout-mode enum (card-pos, layout, align, page-fill, scrim-shape, stack, mobile, width-mode, cover-blur, btn-variant, focus, entrance, scheme, ending-align), always skipping the "today" default. |
| 8 | **Inert gradient/scrim/pattern composer** — the audited `pageBackground()`/`safeCssUrl` posture | button gradient (C9/B6), card gradient (E15), scrim tint/vignette (E4/E12), patterns/noise (E3/E11). |
| 9 | **Bounded-input → CSS-value mappers** — enum→weight, enum→cubic-bezier, enum→duration, enum→radius, ratio-string→number | centralized so no raw value reaches CSS as text. |
| 10 | **Section/group block + fieldset a11y** — the `section` content block + the radio/checkbox `<fieldset>/<legend>` fix | one grouping render convention over the flat field array (layout 7, background E10, a11y A3). |
| 11 | **Theme wire format** — `themeFileSchema` = `appearanceSchema` envelope | export/import (#3), My-Themes (#7), account Brand Kit (#11). |

> The **option-object model (A)** and the **per-state color engine (2)** are the two
> keystones — build them deliberately as their own workstreams before fan-out.

---

## 7. Architecture — the per-field module refactor

### 7.1 Why

Every one of the 15+ field workstreams edits the same four shared files:
`form-schema.ts` (one discriminated union), `form-renderer.ts` (`renderControl` +
`validateField` switches), `schema-validator.service.ts` (`validateValue` switch),
and the admin `TypeSpecificSettings`/builder switch. Under a "schema-for-all, then
SDK-for-all, then admin-for-all" (layer-sequenced) strategy, each phase is a
single-writer bottleneck: 15 subagents serialize on the same switch statements with
constant merge conflicts on adjacent `case` arms. Coordinated domain batches reduce
cross-domain but not cross-field conflict, which is the dominant collision.

**Recommendation: refactor to per-field modules FIRST**, extracting the shared
foundations before the split, then fan out. Each field becomes self-contained;
subagents touch disjoint files and never collide. Given the roadmap is explicitly
per-field and ongoing, the one-time refactor cost amortizes immediately.

### 7.2 Registry shape

```
packages/shared/src/schemas/fields/
  text/       schema.ts     (textFieldSchema + text-only consts/formats)
  email/      schema.ts
  …one dir per type…
  _shared/                  (option-object, transform, mask, domain, anchor, data-* helpers)
  registry.ts               (imports each schema → builds the discriminatedUnion)

packages/forms-sdk/src/ui/fields/
  text/       render.ts, validate.ts
  …
  registry.ts               (type → {render, validate})

apps/backend/.../submissions/fields/
  text/       validate.ts
  …
  registry.ts               (type → server validate)

apps/admin-forms/src/routes/builder/fields/
  text/       settings.tsx
  …
  registry.ts               (type → settings panel component)
```

Each field module exports four contracts:

- **schema** — its `ZodObject` member. **Must stay a plain object** (nested `.refine`d
  sub-schemas only) so the discriminated union stays a union of plain objects; the
  registry must never wrap members in `ZodEffects`.
- **render(field, ctx)** — replaces its `renderControl` case.
- **validate(field, value)** — the pure function imported by **both** the SDK client
  validator and the server validator where logic is identical (server stays
  authoritative; SDK adds UX-only mirrors).
- **settings(field, dispatch)** — replaces its `TypeSpecificSettings` case.

The four shared files become registries:
`formFieldSchema = discriminatedUnion('type', Object.values(registry).map(m => m.schema))`;
`renderControl = registry[field.type].render(...)`; etc. **Cross-field
`superRefine`** (key uniqueness, hidden-source consistency) stays at the
union/`formFieldsSchema` level — a small shared file every module registers into.

### 7.3 Risk / mitigation / test-locked no-op

| Risk | Mitigation |
|---|---|
| Union must remain a union of plain `ZodObject`s | keep refines nested or at `formFieldsSchema` level; registry never wraps in `ZodEffects`. |
| Behavior must be byte-identical post-refactor | **land the refactor as a no-op, test-locked PR first** — gate with existing `form-schema.test.ts` / `form-renderer.test.ts` / `schema-validator.test.ts` as golden regression; no behavior change in the refactor PR. |
| Tree-shaking / Zod in SDK bundle | keep field modules' Zod-free constants separate (the `form-adornments.ts` pattern) so the SDK bundle never pulls Zod. |
| One-time coordination cost | real but bounded and paid once; extract shared foundations (A, E, F, H, I, J from §6.1) into `fields/_shared/` before/with the split so modules import rather than duplicate. |

**Fallback if the refactor can't be scheduled:** sequence by layer with a single
owner per shared file per wave, accepting serialization — but this does not scale to
the ongoing per-field roadmap and re-incurs conflict on every future field change.

---

## 8. Data model

### 8.1 Tables / columns touched

Base tables are defined in `0001_initial.ts` (and `form_export_jobs` in
`0002_export_jobs.ts`), reproduced below from the shipped migrations so this umbrella
is self-contained (folded from `PRD.md` "Data model"). Standard platform tables
(`merchants`, `oauth_tokens`, `webhook_log`) are unchanged. Module-private tables:

**`forms_configs`** (PK `merchant_id`; seeded on install) — the merchant-level config:

| Column | Type | Notes |
|---|---|---|
| `merchant_id` | varchar(128) PK | FK → `merchants.id` |
| `recaptcha_site_key` | varchar(255) NULL | reCAPTCHA v3 site key (shared Ratio key default; per-merchant override) |
| `recaptcha_secret_enc` | text NULL | **secret, AES-256-GCM encrypted**; write-only in Admin (GET returns `hasSecret`) |
| `recaptcha_threshold` | decimal(3,2) NOT NULL | default **0.30** |
| `default_notification_email` | varchar(320) NULL | fallback recipient |
| `email_bounced` | boolean NOT NULL | default false; drives the Admin bounce warning banner |
| `forms_enabled` | boolean NOT NULL | default true; per-merchant **kill switch** |
| `created_at` / `updated_at` | datetime(3) | |

**`forms`** (PK `id` varchar(64), e.g. `form_<nanoid>`) — index `idx_forms_merchant_deleted`:

| Column | Type | Notes |
|---|---|---|
| `merchant_id` | varchar(128) NOT NULL | FK → `merchants.id` |
| `name` | varchar(255) NOT NULL | internal label |
| `schema_json` | json NOT NULL | ordered `FormField[]` (per-field enrichment lands here) |
| `submit_label` | varchar(100) NOT NULL | button text |
| `success_message` | text NOT NULL | shown after submit |
| `spam_protection` | varchar(16) NOT NULL | default `recaptcha` (`recaptcha`/`honeypot`) |
| `notification_email` | varchar(320) NULL | per-form recipient; falls back to config default |
| `webhook_url` | varchar(2048) NULL | `form.submitted` consumer (e.g. KwikEngage) |
| `status` | varchar(16) NOT NULL | default `inactive` (`active`/`inactive`) |
| `deleted_at` | datetime(3) NULL | **soft delete only** |
| `created_at` / `updated_at` | datetime(3) | |
| *(+ `appearance_json`, `description`, `redirect_url`)* | | added by this PR — see table below |

**`form_submissions`** (PK `id` varchar(64), `sub_<nanoid>`) — index `idx_form_submissions_form_created`:

| Column | Type | Notes |
|---|---|---|
| `form_id` / `merchant_id` | varchar | |
| `data_json` | json NOT NULL | field key → value map |
| `files_json` | json NULL | field key → S3 key (reshaped by multi-file — see §8.3) |
| `recaptcha_score` | decimal(3,2) NULL | null in honeypot mode |
| `idempotency_key` | varchar(128) UNIQUE NOT NULL | hash(form_id + session + 5 s bucket) dedup |
| `created_at` | datetime(3) | list sort + export |

**`form_webhook_deliveries`** (PK `id` bigint AI) — index `idx_form_webhook_deliveries_status_retry`:

| Column | Type | Notes |
|---|---|---|
| `submission_id` / `form_id` / `merchant_id` | varchar NOT NULL | |
| `url` | varchar(2048) NOT NULL | endpoint at enqueue time |
| `status` | varchar(16) NOT NULL | default `pending` (`pending`/`delivered`/`failed`) |
| `attempts` | tinyint NOT NULL | default 0; retry schedule **5 m / 20 m / 1 h** |
| `last_status_code` | smallint NULL | shown in Admin ("Failed: 404") |
| `next_retry_at` | datetime(3) NULL | |
| `created_at` / `updated_at` | datetime(3) | |

**`form_email_log`** (PK `id` bigint AI) — index `idx_form_email_log_status_retry`:

| Column | Type | Notes |
|---|---|---|
| `submission_id` / `merchant_id` | varchar NOT NULL | |
| `recipient` | varchar(320) NOT NULL | |
| `status` | varchar(16) NOT NULL | default `pending` (`pending`/`sent`/`failed`/`bounced`); **1 retry after 10 min**; bounce → Admin warning banner |
| `attempts` | tinyint NOT NULL | default 0 |
| `next_retry_at` | datetime(3) NULL | |
| `created_at` / `updated_at` | datetime(3) | |

**`form_export_jobs`** (`0002_export_jobs.ts`, PK `id` varchar(64)) — index `idx_form_export_jobs_merchant_form_created`:

| Column | Type | Notes |
|---|---|---|
| `form_id` / `merchant_id` | varchar NOT NULL | |
| `status` | varchar(16) NOT NULL | default `pending` |
| `s3_key` | varchar(512) NULL | CSV artifact location |
| `row_count` | integer NULL | |
| `error` | varchar(512) NULL | |
| `created_at` / `updated_at` | datetime(3) | |

**Secrets encrypted at rest:** `recaptcha_secret_enc` only (plus platform
`oauth_tokens`). Submission data is PII but not a credential — stored as plain JSON in
the module-private DB.

This PR touches:

| Table | Column | Change | Migration |
|---|---|---|---|
| `forms` | `appearance_json` | **added** — `JSON NULL`; holds the full `appearance` object. All theming enrichment (global keys) lands here — no further migration. | `0003_form_appearance.ts` (delivered) |
| `forms` | `description` | **added** — `varchar(500) NULL`; form subtitle/heading. | `0004_form_metadata.ts` (delivered) |
| `forms` | `redirect_url` | **added** — `varchar(2048) NULL`; https redirect-on-submit target. | `0004_form_metadata.ts` (delivered) |
| `forms` | `schema_json` | **shape only** — all per-field enrichment (masks, options-objects, formatting, layout, etc.) lands as additive Zod keys inside the existing `FormField[]` JSON. No migration. | — |
| `form_submissions` | `files_json` | **shape reshape** (no migration) — see §8.3. | — |
| `form_submissions` | `context_json` | **the ONE new migration flagged in the plan** — see §8.2. | *planned* `0005_submission_context.ts` |

### 8.2 The one new migration — hidden-field provenance (`context_json`)

The hidden-field **provenance** enrichment (§4.14 P1 row) is the only planned item
that needs a schema migration. When hidden fields capture provenance beyond a raw
URL param (server-recorded referrer, landing URL, timestamp, IP-derived context),
the server must persist a structured context blob distinct from user-submitted
`data_json`. Plan:

- New nullable `context_json JSON NULL` on `form_submissions`, in a new reversible
  Kysely migration (`0005_submission_context.ts`), applied via
  `tsx scripts/migrate.ts forms`. `db/types.ts` updated in lockstep.
- Written server-side only (never merchant-authored); the multi-source resolution
  consistency checks live in `formFieldsSchema.superRefine` (union-safe), and the
  server hardens `constant`/`timestamp` sources.
- Sequenced **after** the hidden-P0 fallback + multi-source work; it is not part of
  the P0 wave.

All other hidden-field keys (`source`, `paramName`, `constantValue`, `fallback`,
`allowedValues`) are additive Zod keys in `schema_json` — no migration.

### 8.3 File multi-file reshape of `files_json`

The multi-file upload P0 (§4.8) reshapes the submission file map **without a
migration** (JSON column). Today `files_json` is `Record<fieldKey, string>` (one S3
key per file field). Multi-file makes it `Record<fieldKey, string[]>`. Because it is
a JSON column, no DDL is needed, but **every read path must union the legacy shape**:

- `submissions.service.ts` `toListItem` / `detail` (signed-URL fan-out over an
  array), `PublicFormSchema` consumers,
- webhook delivery payload builder,
- CSV export column serialization,
- SDK client `SubmissionInput.files` type and the presign loop
  (`Record<fieldKey, string[]>`).

Legacy rows (`string`) and new rows (`string[]`) coexist; readers normalize
`typeof v === 'string' ? [v] : v`. `schema-validator.service.ts` `validateFile` loops
per key in the array, each key re-checked under the `merchant/form/` prefix guard.

---

## 9. Data flow, API surface, public read path

### 9.1 Write path (admin)

Admin Design tab / builder → `updateAppearance` reducer (deep-merge `AppearancePatch`)
and field edits → client-side `formInputSchema.safeParse` (validates `appearance` +
`schema` for free) → `POST/PUT /forms/api/forms[/:id]` → `formInputPipe` validates →
`FormsService.create/update` stringifies `appearanceJson` + `schemaJson` (mysql2 does
not auto-serialize) → row persisted. `duplicate` copies both JSON columns. No
controller change is needed for new appearance/field keys — the pipe validates them
automatically.

### 9.2 Public read path (the piece that actually reaches the widget)

`GET /forms/public/v1/forms/:formId` → `SubmissionsService.getPublicSchema` →
loads the form (404 if missing/deleted; 403 `form_unavailable` if kill-switched; 403
`form_inactive` if not active; 404 if empty schema) → parses `schema_json` and
`appearance_json` (`parseAppearance`, nullable → `undefined` for un-themed) →
returns `PublicFormSchema` including `appearance?`, `description?`, `redirectUrl?`,
`spamProtection`, `recaptchaSiteKey?`. Secrets (emails, webhook URL, reCAPTCHA
secret) are stripped. The SDK `client.ts` `PublicFormSchema` type mirrors this
(type-only import so Zod stays out of the browser bundle).

### 9.3 Render path (SDK)

`<ratio-form>` fetches the schema (or, in preview, reads inline props), stores
`appearance` in reactive `@state`, injects `<style>${themeVars(appearance)}</style>`
inline in `render()` (custom properties pierce the shadow boundary and layer over
the `baseStyles` adopted sheet), reflects appearance variants to host `data-*`
attributes in `updated()` (`reflectAttr`, skipping "today" defaults), lazy-injects a
document-scope font `<link>` when a non-system family is set, and lazy-injects
reCAPTCHA only when the form uses it. Content blocks render via `textContent`;
images/logos/covers via the audited https path; page background via the inert
gradient/scrim composer.

### 9.4 Submit path (server re-validation)

`POST /forms/public/v1/forms/:formId/submissions` runs the ordered guard chain
(rate limit → active/kill-switch → spam → **server schema re-validation** →
idempotency → insert + enqueue). `SchemaValidatorService.validate` is authoritative:
it rejects unknown keys (no mass-assignment), required-checks, and per-type value
validation. Every server-authoritative enrichment (text transform/format/hard-max,
email normalize/free-provider/domain lists, phone per-country, date bound
re-resolution, url normalize/https/length, rating min, number step/decimals,
multi_select min/max, option `optionValues()` membership, "Other" relaxation) adds
its logic here — content blocks are skipped (`isCollectableFieldType`). This is where
the shared **pure** transform/validate functions (§6.1 E) are imported so the SDK's
UX mirror never disagrees with the authoritative verdict.

**Baseline guard-chain parameters (folded from `PRD.md`).** The ordered chain above
carries these specific, delivered parameters — enrichment must preserve them:

1. **Per-IP rate limit — 5 requests / 10 min**, via the `main.ts` rate-limit buckets.
2. **Form active check** — a non-`active` form rejects with `403 form_inactive`; a
   kill-switched merchant (`forms_enabled=false`) rejects with `403 form_unavailable`.
3. **Spam / reCAPTCHA v3 server-side verify** — the score is compared against
   `forms_configs.recaptcha_threshold` (default 0.30); a submission **below** the
   threshold is **silently rejected**. If the reCAPTCHA API is **down**, the server
   **falls back to honeypot-only** validation and emits a **warning log**.
4. **Honeypot field** — a hidden trap; any value present marks the submission spam.
5. **Server-side schema re-validation** — authoritative (above).
6. **Idempotency dedup** — a duplicate within the 5 s bucket is rejected.
7. **Insert → enqueue** email + webhook jobs (SQS workers).

**File uploads** go **direct to S3 via a presigned URL before submit**; the presign /
validation path returns **413 on files > 5 MB** and rejects unsupported MIME types.
The endpoint is **public and unauthenticated** (POST), unlike every other route in the
repo. The SDK **disables submit after the first click** to prevent double-post.

### 9.5 Baseline infrastructure, scopes & inbound webhooks (folded from `PRD.md`)

The enrichment adds **no new external services** (§1.4); the workers stay env-gated.
For completeness, the v1 infrastructure prerequisites, scopes, and inbound webhook
still hold:

**Infrastructure prerequisites (flag for TRD):**

1. **Transactional email provider** (Resend/Postmark or Ratio-managed) + sender
   domain (`noreply@ratio.store`) — net-new; nothing else in the repo sends email.
2. **S3 bucket** with per-merchant prefixes; presigned upload + signed **7-day**
   download URLs.
3. **reCAPTCHA v3 keys** — shared Ratio key to start, per-merchant override supported
   in config.
4. **Two SQS queues** (email, webhook delivery) + **DLQ**, drained by **self-gating
   workers** (`FORMS_EMAIL_WORKER_ENABLED`, `FORMS_WEBHOOK_WORKER_ENABLED`).

**Scopes / permissions:** none beyond the app install identity. Form Builder
reads/writes only its own module database; it never touches orders, products, or
customers. Storefront placement is via the SDK script/iframe embed, which needs no
scope.

**Inbound Ratio webhook events:** only **`app/uninstalled`** — flips the merchant
**inactive** (default handler); forms and submissions are **preserved** for reinstall.
No other inbound topics. The app's own **outbound** `form.submitted` webhook to
merchant endpoints (payload in §10.0) is app infrastructure, not a Ratio webhook.

---

## 10. Acceptance criteria, rollout, deferrals, open questions

### 10.0 Baseline v1 acceptance criteria (folded from `PRD.md` — still hold)

The enrichment ACs in §10.1 are **additive**. The original v1 acceptance criteria
remain in force and must not regress:

- [ ] **Install flow** — OAuth callback upserts the merchant, seeds `forms_configs`;
  `app/uninstalled` flips the merchant inactive, data preserved.
- [ ] **Create form** — the builder creates a form with **all 8 baseline field
  types**, reorders fields, configures validation, and publishes; schema persists as
  JSON. *(The enrichment raises the collectable set well beyond these 8 — §3.2.)*
- [ ] **Duplicate + toggle** — a form can be duplicated and toggled active/inactive;
  an inactive form rejects submissions with `403 form_inactive`.
- [ ] **Soft delete** — `deleted_at` is set, the form is hidden from the list, the
  storefront renders "no longer available", and submissions are retained.
- [ ] **SDK client-side validation** — the storefront SDK renders a published form
  from its schema, validates client-side (required, email format, +91 10-digit phone,
  file ≤ 5 MB + type), and submits successfully end-to-end.
- [ ] **Public submission guard chain** — the endpoint enforces, in order: IP rate
  limit (5/10 min), active check, reCAPTCHA verify (threshold from config; honeypot
  fallback when reCAPTCHA is unavailable), server-side schema re-validation,
  idempotency (dup within 5 s rejected). *(Full parameters in §9.4.)*
- [ ] **Submission storage + list** — submission stored with data JSON + S3 file
  keys; the Admin submissions list paginates, sorts by date, expands rows, and serves
  files via **signed S3 URLs**.
- [ ] **CSV export** — downloads the **full submission history** for a form.
- [ ] **Email notification** — enqueued per submission; failure retried **once after
  10 min**; status (incl. **bounce**) visible in Admin.
- [ ] **`form.submitted` webhook** — delivered with the documented payload:
  `event`, `merchant_id`, `form_id`, `form_name`, `submitted_at`, `submission_id`,
  `fields`, `schema_version "1.0"`; non-2xx retried at **5 m / 20 m / 1 h**; after 3
  failures marked failed with the last status code; **manual re-trigger** works;
  **"Send test payload"** works from the builder.
- [ ] **Kill switch** — `forms_enabled=false` makes all forms render "temporarily
  unavailable" and **pauses** the webhook queue; re-enabling **drains** it.
- [ ] **reCAPTCHA secret** — write-only in Admin (GET returns `hasSecret`), stored
  AES-256-GCM encrypted.
- [ ] `pnpm -r lint && pnpm -r typecheck && pnpm -r build` pass.

### 10.1 Acceptance criteria (exhaustive)

1. Every delivered appearance token **and** field enrichment is applied by the SDK
   *and* exposed in the admin — **no dead controls** (verified by an automated
   admin↔SDK capability check using the shared adornment/field matrices).
2. Admin preview is **visually identical** to the storefront embed for every field
   type and theme (it embeds the real widget; there is one renderer).
3. A dark/branded preset renders with **zero light-gray/off-theme artifacts**; WCAG
   AA contrast enforced/warned on merchant colors (warn + auto-fix, never block).
4. **Defaults reproduce the pre-enrichment look** for any existing form
   (`themeVars(undefined)` byte-identical; golden regression tests on the field
   layers pre/post refactor).
5. **No merchant value reaches the widget as raw CSS/HTML/URL**; images/fonts only
   via the audited https-asset / curated-enum paths; paragraph/heading/help/prefix
   via `textContent`; every `url()` built by the SDK after `safeCssUrl` re-check.
6. Workspace green: `pnpm -r lint && pnpm -r typecheck && pnpm -r build` + tests
   across shared, forms-sdk, admin-forms, backend; **storefront widget ≤ 32 KB**
   (verify with `pnpm size`).
7. **No DB migration for field/appearance config** (JSON columns). Any column-level
   change ships a reversible Kysely migration and is applied via
   `tsx scripts/migrate.ts forms` — the delivered `0003`/`0004`, and the single
   planned `0005_submission_context.ts` for hidden-field provenance.
8. The `files_json` multi-file reshape carries the legacy-`string` union on **all**
   read paths (list, detail signed URLs, webhook payload, CSV export, SDK type);
   legacy single-file rows still render and export correctly.
9. The two a11y defects are fixed independently of feature work: radio/checkbox
   `<fieldset>/<legend>` grouping (§5.3-7 / §5.11-A3) and browser-autofill styling
   (§5.4-I1). Loading-state focus is preserved (`aria-busy`, not `?disabled`
   focus-drop) (§5.5-B2).
10. The per-field module refactor lands as a **test-locked no-op** before any
    enrichment; the discriminated union remains a union of plain `ZodObject`s; the
    SDK bundle pulls no Zod.
11. Server re-validation is authoritative for every server-impacting enrichment; the
    SDK client mirror imports the same pure functions so verdicts never diverge.

### 10.2 Phased build order

**Wave 0 — shared substrate (unblocks everything).** Per-field module refactor
(registries across the four files, test-locked no-op) + extract shared foundations
(option-object A, transform E, mask/format F, domain H, https-anchor I, `data-*`/token
J). Theming substrate in `theme.ts`: typography role tokens (`--wz-fs-*`), per-state
color engine, motion token set, shadow-scale extension, focus-indicator token group;
in `form-renderer.ts`: `.rf-bg` image layer, `.rf-cq` named container (R1), refined
reduced-motion contract, generalized reflection helper.

**Wave 1 — P0 across sections (mostly free, highest payoff).** Renderer a11y +
correctness (A1–A4/A6/A8, I1 autofill, B2 loading a11y + spinner, B3 touch height,
layout-7 fieldset fix, R2/R3/R4/R9, E1/E2 focus, ending E1–E4); theming P0 tokens
(C1/C4, T1/T2/T4, layout 2/3/4/5, background E1a/E1b/E2a, B1, focus E3/E4, logo
B1/B2); field P0 waves — **2a** no-server-change appearance/behavior (textarea
display, radio layout/variant, multi_select display/select-all, file
selected-UI/preview/dropzone/MIME/progress, content-block align/size/caption/divider,
checkbox inline-consent/multi-link, text autocomplete/native-length, number
formatting, rating endpoint labels); **2b** server-touching items (text
transform/format, email normalize/free-provider/domain, phone multi-country, date
min/max/default, url https/length/normalize, rating min/buttons, multi_select
min/max, number decimals/grouping, hidden fallback/multi-source); **2c** dropdown P0
(option-object, value≠label, default, bulk-paste, searchable + the coordinated
`optionValues()` server one-liner across the three option fields). Schema declares all
P0 keys (`.strict()`); `DesignSettings` gains Motion/Responsive/Accessibility/Ending
panels + contrast-engine upgrade; `presets.ts` thumbnails/categories/export-import
(admin-only, parallel).

**Wave 2 — P1 expressive polish.** Typography T3/T5/T6/T8/T9, color C5–C10, buttons
B4–B11, background E3–E8, focus/motion E6–E11, endings E5–E9/E16, branding B3/B4/B6/B7,
responsive R5–R10, a11y A9–A15; per-field P1s (email confirm, phone
extension/mobile-only, dropdown descriptions/groups/images/Other, date time/range,
checkbox group/default-checked, number slider/steppers/unit, url domain-allowlist,
rating half-star/icons/labels, hidden allowlist, text input-mask, paragraph
markdown-lite).

**Wave 3 — structural / gated (own tracked changes).** **file multi-file** (`files_json`
reshape, solo workstream); **hidden provenance** (`context_json` migration, the only
migration, post-hidden-P0); layout/background section blocks & split-screen (7/E9/E10);
SDK dark mode (presets #10 + `colorsDark`); multi-step nav (B12, gated on pages
engine); ending conditional/piping (E11–E15); branding hero/social; focus/motion
confetti/scroll-reveal; responsive sticky/cqi-media; a11y A16–A19; hosted-route head
(favicon B5, OG B11, powered-by clamp B4).

**Critical path.** Wave 0 → 2c (option fields) and Wave 3 (multi-file) are the only
true sequencing constraints; everything else in Wave 1/2 fans out freely once the
module refactor and shared primitives exist.

### 10.3 Deferred Tier-3 (with rationale)

| Item | Rationale for deferral |
|---|---|
| Raw custom CSS (AST allowlist) | Data-exfiltration vector on an embeddable widget (attribute-selector + `background:url()` leaks values char-by-char; `:has()` reaches hidden fields; `@font-face src`/`@import` make external requests). Token API covers Tier-1 needs with near-zero risk. If ever built: real CSS AST, property allowlist, strip every `url()`/`image-set()`/`@import`/`@font-face`, re-serialize, inject **shadow-root-only**. |
| Video backgrounds | Off-origin fetch + third-party origin + perf + autoplay a11y; conflicts with the no-off-origin posture. |
| Full per-state input styling matrix | Large admin surface for marginal gain; keep the curated built-in hover/focus/error states. |
| Custom font upload / arbitrary Google Fonts | Breaks the enum-only, no-dynamic-URL font posture (`GOOGLE_FONT_HREF` fixed-keyed); reopens injection surface + network cost. |
| Per-question image layouts (stack/split/float/wallpaper) | Tied to a one-question-per-screen guided engine we don't have. |
| Multi-step / paged forms + progress bar | Separate structural workstream (schema page/section grouping + renderer step state); progress-bar tokens stubbed now so it's free later. |
| Confetti / scroll-reveal | Lazy/observer-based; only instantiate behind a flag; bundle-budget sensitive. |
| Conditional endings / answer piping / email-edit-PDF endings | Need a logic engine / backend work outside this PR. |

### 10.4 Open questions

1. **Raw custom CSS?** Recommendation: no (defer behind AST allowlist). Confirm
   acceptable, or flag which merchants need it.
2. **Preset count & curation ownership** — expand 6 → ~20 with categories/industries;
   needs design/brand sign-off on palette values.
3. **Contrast enforcement policy** — warn + auto-fix (current) vs hard-block save.
   Recommendation: warn + auto-fix, never block (matches every researched builder).
4. **Multi-step engine timing** — unblocks progress-bar (2.5/B12), per-question
   layouts, and the pages structural work.
5. **Font library scope** — keep the curated ~9-font enum, or add a hosted validated
   upload pipeline (reopens injection surface; deferred by default)?
6. **Success / ending screen richness & redirect** — promote `successMessage` to a
   structured themed `endings` panel with countdown/redirect (§5.9)?
7. **`maxWidth` / full-bleed** — form-only vs a centered full-bleed page layout when
   embedded (`pageFill`, layout 5)?
8. **Dark mode model** — treat dark as "just another preset/colors" vs a first-class
   SDK `colorScheme` with `@media prefers-color-scheme` (auto-switch would fight
   merchant-picked colors)?
9. **"My Themes" / account Brand Kit storage** — localStorage v1 → existing account
   JSON column; avoid a new table (§5.7-7/#11).

### 10.5 Rollout

Single feature branch `feat/form-builder`, comprehensive PR. Deploy: rebuild the
storefront SDK widget (backend serves it) + admin bundle, then the standard dashboard
publish/install. Apply any column migration via `tsx scripts/migrate.ts forms`. Branch
is local-only in this environment (no remote push); the PR is prepared PR-ready for an
authenticated push.
