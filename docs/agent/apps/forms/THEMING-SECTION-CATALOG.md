# Consolidated Theming Enrichment Catalog — Ratio Form Builder

Single source of truth across all 12 theming sections. Every item obeys the security model (hex / enum / https-asset / bounded-number / bounded-string only; SDK composes all CSS; no raw CSS/HTML/URL from merchant) and the no-migration rule (everything lands in the `appearance_json` JSON column; `appearanceSchema` is `.strict()` so each new global key must be declared). Existing shipped controls are **not** relisted as new.

Files referenced throughout: `packages/shared/src/schemas/form-schema.ts` (schema), `packages/forms-sdk/src/ui/theme.ts` (`themeVars()`, `baseStyles`, `SHADOWS`, `DENSITY`, `BUTTON_SIZE`), `packages/forms-sdk/src/ui/form-renderer.ts` (render + `data-*` reflection in `updated()`), `apps/admin-forms/src/components/DesignSettings.tsx` (Orion panels + `ContrastReport`), `apps/admin-forms/src/lib/contrast.ts`, `apps/admin-forms/src/lib/presets.ts`.

---

## 1. Per-section enrichment tables

### 1.1 Color system

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | C1 | Brand reaches native controls + selection | (none) `--wz-accent`, `--wz-selection` | `:host{accent-color}` + `::selection` | auto | S |
| P0 | C2 | Tokenize per-state colors | (none) `--wz-primary-active/-soft/-border`, `--wz-disabled-bg/-fg`, `--wz-error-bg/-ring` | promote inline `color-mix` to named tokens | none | S-M |
| P0 | C3 | First-class `success` (+`warning`/`info`) | `colors.success/warning/info` optional | `--wz-success`, `--wz-success-bg/-border`, auto `--wz-on-success` | 3 optional ColorPickers | S |
| P0 | C4 | Placeholder + link + label tokens | `colors.link` optional; placeholder derived | `--wz-placeholder`, `--wz-link` + underline | Link ColorPicker | S |
| P1 | C5 | Alpha/opacity authoring | `colors.borderAlpha/surfaceAlpha` 0–1 | `color-mix` % feed; enable alpha in picker | alpha slider + 2 Sliders | S |
| P1 | C6 | Palette generation from one hex | `colors.seed` optional (provenance) | none (admin emits hex) | ColorPicker + Generate button | M |
| P1 | C7 | Contrast auto-fix + APCA readout | (none) | extend `contrast.ts` w/ APCA `Lc` | per-row Fix button + APCA column | M |
| P1 | C8 | Dark mode as 2nd set | `colorMode` enum, `colorsDark` optional | emit dark block (`@media prefers-color-scheme` for auto) | Segmented + dark palette tab | M-L |
| P1 | C9 | Gradient button/accent fill | `buttonFill`, `buttonGradientFrom/To/Dir` | inert `linear-gradient` → `--wz-btn-bg` | Segmented + 2 pickers + dir | M |
| P1 | C10 | Explicit per-state overrides | `primaryHover/Active`, `disabledBg/Text` optional | override C2 fallback when present | Advanced collapse, 4 pickers | S-M |
| P2 | C11 | Harmony accent suggestions | (writes `link`/`success`/accent) | none | swatch buttons | M |
| P2 | C12 | Tonal scale for primary | (none) `--wz-primary-1/6/9/11` | stepped `color-mix` for chips/selected | auto | M-L |
| P2 | C13 | Per-field accent gradient/tint | `field.style.accentFrom/To` | scoped inline `--wz-*` via `fieldAccent()` | field Advanced style | M |
| — | C14 | **Reject/defer**: animated gradients, raw color functions, full per-state matrix, runtime relative-color | — | — | — | — |

### 1.2 Typography

Prerequisite refactor (P0 backbone): replace `calc(var(--wz-font-size) ± Npx)` element sizes with `--wz-fs-*` role tokens computed in `themeVars()`; defaults reproduce today's 16/18/20.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | T1 | Font pairing (heading/body) | `headingFont`, `bodyFont` optional | `--wz-font-heading/-body`; inject ≤2 links | 2 Selects | S |
| P0 | T2 | Ratio type-scale | `scaleRatio` enum (`FORM_TYPE_SCALES`) | compute `--wz-fs-title/-h2/-h3` from `base·rⁿ` | Segmented/Select | M |
| P0 | T3 | Weight tokens per role | `headingWeight/labelWeight/bodyWeight` enum | `--wz-weight-*`; **widen `GOOGLE_FONT_HREF` axes** | 3 Segmented | M |
| P0 | T4 | Line-height (body+heading) | `bodyLineHeight` 1.1–2.0, `headingLineHeight` 1.0–1.6 | `--wz-lh-body/-heading` | 2 Sliders | S |
| P1 | T5 | Letter-spacing/tracking | `headingTracking`, `bodyTracking` (em) | `--wz-track-heading/-body` | 2 Sliders | S |
| P1 | T6 | Text transform/case | `labelCase/buttonCase/headingCase` enum | `text-transform`; DOM text unchanged | 3 Segmented | S |
| P1 | T7 | Per-element sizing | `titleScale/labelScale/inputScale/helpScale` optional | multiply base, clamp ≥12/16px | Advanced sizing group | M |
| P1 | T8 | Expanded library + pairing presets | add families to enum; `FORM_TYPE_PAIRINGS` | new `GOOGLE_FONT_HREF`/`FONT_STACKS` entries | grouped Select + pairing row | S |
| P1 | T9 | Fluid headings | `fluidHeadings` bool | `clamp()` on `cqi` (host `container-type` present) | Switch | M |
| P2 | T10–T16 | Variable-font axis; smoothing toggle; content-block type controls; per-field label type; font-loading `font-display`; numeric glyphs; link decoration | various optional | mostly enum/bool | small controls | S–L |

### 1.3 Layout & spacing

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | 1 | 3-col + per-field span | `columns`+`'3'`, field `span` | `data-cols='3'`, `grid-column: span --_span` | Segmented + per-field Select | M |
| P0 | 2 | Input padX + card inset | `inputPadX`, `cardPadding` | `--wz-pad-x`, `--wz-card-pad` (fixes override bug) | 2 Sliders | S |
| P0 | 3 | Column gutter vs row gap | `columnGap` | `--wz-col-gap`; split `row-gap`/`column-gap` | Slider | S |
| P0 | 4 | Content/heading alignment | `contentAlign` enum | `data-align='center'` on title/desc/heading/logo | Segmented | S |
| P0 | 5 | Card vs flat + fluid width | `layoutMode`, `fluidWidth` | `data-layout='flat'`, `--wz-max-width:none` | Segmented + Switch | S-M |
| P1 | 6 | Whitespace scale multiplier | `spacingScale` 0.75–1.5 | scales gap/padY/cardPad; document precedence | Slider | M |
| P1 | 7 | Section block + **group a11y fix** | `section` block type | `role=group`/`<fieldset><legend>` | palette item + props | M-L |
| P1 | 8 | Vertical rhythm above sections | `sectionGap` | `--wz-section-gap` margin-top | Slider | S |
| P1 | 9 | Label gap + label-left width | `labelGap`, `labelWidth` | `--wz-label-gap`, `--wz-label-width` | 2 Sliders | S |
| P1 | 10 | Responsive stack breakpoint | `stackBreakpoint` enum | `data-stack`; discrete `@container` blocks | Segmented | S-M |
| P1 | 11 | Auto-column min-width | `autoMinWidth` rem | `--wz-auto-min` | Slider | S |
| P2 | 12 | Card alignment in page | `cardAlign` enum | `--wz-card-margin` | Segmented | S |
| P2 | 13 | Logo/cover placement + bleed | `logoAlign`, `coverBleed` | `data-logo-align`, negative margins | Segmented + Switch | S-M |
| P2 | 14 | **Defer**: multi-step page engine (structural) | — | — | — | L |

> The radio/checkbox `<fieldset>/<legend>` accessibility fix inside item 7 is a real WCAG 1.3.1/4.1.2 defect — ship it independently of the `section` block.

### 1.4 Inputs

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| **P0** | I1 | **Autofill styling fix** (breaks dark/filled today) | (none) | `:-webkit-autofill` box-shadow inset + `text-fill-color` reading `--_fill` | none | S |
| P1 | I2 | Input size + touch min-height | `inputSize` enum | `--wz-input-min-h` (34/40/48) orthogonal to density | Segmented | S/M |
| P1 | I3 | Placeholder color | `colors.placeholder` (defaults to muted) | `::placeholder{color;opacity:1}` | ColorPicker + contrast pair | S |
| P1 | I4 | Leading/trailing icons | field `prefixIcon/suffixIcon` enum | curated `INPUT_ICONS` SVG inside field | 2 Selects | M |
| P1 | I5 | Inline validation timing | `validateOnBlur` bool | `@blur` validate + escalate to `@input`; `aria-live` | Switch | M |
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
| P2 | I17 | Floating-label hardening | (none) | contrast check floated label; copy nudge | — | S |

### 1.5 Buttons

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin control | Effort |
|---|----|-----------|--------------------|--------------|---------------|--------|
| P0 | B1 | Variant solid/outline/ghost/soft | `buttonVariant` enum | `data-btn-variant` token-flip | Segmented | S |
| **P0** | B2 | **Loading spinner + `aria-busy`** (fixes a11y bug: `?disabled` drops focus) | `buttonLoader` enum | `aria-disabled`+`aria-busy`+live region; reduced-motion spinner | Segmented | S/M |
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

### 1.6 Background & surface

Structural addition unlocking several items: a dedicated `.rf-bg` image layer (`position:absolute;inset:0;z-index:-1`) so filters/patterns never touch card/content.

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

### 1.7 Presets & themes (almost all admin-only, zero SDK/schema)

| P | ID | Enrichment | Schema/SDK? | Behavior | Admin | Effort |
|---|----|-----------|-------------|----------|-------|--------|
| P0 | 1 | Expand library 6→~20 + categories | No/No | TS-only `category`/`industries` on `AppearancePreset` | category tabs + search | M |
| P0 | 2 | Live preview thumbnails | No/No | mini-card via `themeVars(preset.appearance)` | replace 3-dot | S |
| P0 | 3 | Theme export/import JSON | No*/No | wire format = `appearanceSchema`; admin `themeFileSchema` envelope | Export btn + Upload | S |
| P0 | 4 | Per-industry starters | No/No | `industries` tag + filter | Select filter | S |
| P1 | 5 | Brand-kit from logo (client-side) | No/No | canvas quantize (admin bundle) → hex + AA post-pass | Generate button | M |
| P1 | 6 | Light/dark preset pairing | No/No | `dark?: FormAppearance` on preset (pick-one) | light/dark toggle | S |
| P1 | 7 | "Save as theme" (My Themes) | No†/No | localStorage v1 → existing account JSON | Save + My-themes row | M |
| P1 | 8 | Granular apply (colors-only/full) | No/No | partial `AppearancePatch` | Segmented apply mode | S |
| P1 | 9 | Source-color generator | No/No | HCT/HSL util (admin) + AA pass | picker + Generate | M |
| P2 | 10 | First-class SDK dark mode | **Yes/Yes** | `colorScheme` enum + `colorsDark`; `data-scheme` + `@media` | Segmented + dark group | L |
| P2 | 11 | Account Brand Kit | †storage/No | #5+#7 promoted, account-scoped | — | L |
| P2 | 12 | AI theme-from-prompt | No/No | LLM → hex/enum → AA pass | prompt input | M |
| P2 | 13 | Preset `presetId` stamp | tiny Yes/No | `presetId` bounded string | — | S |

### 1.8 Focus & motion

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

### 1.9 Ending states

Storage: new `appearance.endings` object (content + behavior nest here since `successMessage`/`redirectUrl` are scalar columns). Backward-compat chain `endings.success.body ?? successMessage ?? default`.

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
| P2 | E12–E15 | **Defer**: conditional endings (logic engine); answer recall/piping; email/edit/PDF (backend); confetti | various | — | — | M-L |

### 1.10 Branding

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
| P2 | B12–B13 | **Fold-in/out of scope**: watermark (use bg image); account brand-kit (separate entity) | — | — | — | M/L |

> Extend `applyPreset()` preserve-rule so `branding`, `favicon`, `footer`, `share` survive preset swaps (as `logo`/`cover` already do).

### 1.11 Accessibility

New `appearance.a11y` object (one `.strict()` addition) + top-level `dir`/`lang`. Items marked *(renderer-only)* need no schema and are always-on correctness fixes.

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

### 1.12 Responsive container

New `appearance.responsive` object. **R1 is a prerequisite** for R4/R5/R12 and R7 correctness.

| P | ID | Enrichment | Schema key / token | SDK behavior | Admin | Effort |
|---|----|-----------|--------------------|--------------|-------|--------|
| P0 | R1 | **CQ anchor fix**: `container-type` on card, named | (none) | move to `.rf-cq`; name `@container wz` | none | S |
| P0 | R2 | Mobile full-bleed vs inset | `responsive.mobileLayout` | `data-mobile='bleed'` + safe-area | Segmented | M |
| P0 | R3 | Touch-target floor | `responsive.touchTargets` enum | `--wz-tap-min`; `@media pointer:coarse` | Segmented | S |
| P0 | R4 | Container gutter (`vw`→`cqi`) | `responsive.pagePadding` opt | `clamp(24px,6cqi,72px)` | Slider | S |
| P1 | R5 | Fluid typography (`cqi` clamp) | `responsive.fluidType` bool | `clamp` on `--wz-font-size` | Switch | M |
| P1 | R6 | Adaptive density | `responsive.adaptiveDensity` bool | narrow `@container` density step | Switch | M |
| P1 | R7 | Stack breakpoint (enum) | `responsive.stackBreakpoint` enum | `data-stack`; **can't read vars in `@container`** | Segmented | M |
| P1 | R8 | Embed auto-resize height | SDK attr / opt `maxEmbedHeight` | `ResizeObserver`+`postMessage` (**origin-pinned**) | embed-flow toggle | M/L |
| P1 | R9 | Tiny-container overflow hardening *(render)* | (none) | shrink flanked input; rating wrap; `overflow-x:clip` | none | S |
| P1 | R10 | Width mode fixed/fluid | `responsive.widthMode` enum | `data-width-mode` | Segmented | S |
| P2 | R11–R13 | Sticky submit; responsive cover/logo `cqi`; auto-fit col min | various | — | — | S/M |
| — | R14 | **Reject/defer**: height CQs, scroll-state, orientation, print, JS font-resize (superseded by R5) | — | — | — | — |

---

## 2. Cross-section reusables (build once, consume everywhere)

These recur across ≥3 sections. Building them as shared primitives eliminates duplication and keeps the widget small.

1. **Elevation / shadow scale** — one `SHADOWS` map (`none/sm/md/lg/xl` + optional tinted variant) in `theme.ts`. Consumed by: background-surface (E2a/E14), buttons (B7), cards. Single `FORM_SHADOWS` enum.
2. **Per-state color engine** — the `--wz-primary-hover/-active/-soft/-border`, `--wz-disabled-bg/-fg`, `--wz-error-bg/-ring`, `--wz-success*`, `--wz-on-*` tokens (color-system C2/C3). Consumed by inputs (I8/I11), buttons (B1/B9), ending-states (E3), focus-motion (error ring). Build the derivation table in `themeVars()` once; explicit overrides (C10) layer on top.
3. **Motion token set** — `--wz-dur-fast/base/slow`, `--wz-ease`/`--wz-ease-out`, plus the **refined reduced-motion contract** (degrade to end-state, don't blanket-kill). Consumed by focus-motion (all), buttons (B2/B8), inputs (I5), ending-states (E10), background (transitions). Single `motionSpeed`/`easing` resolution in `themeVars()`.
4. **Contrast / palette utility** — extend `contrast.ts` to `meetsContrast(fg,bg,{level,large})` with AA/AAA + large-text + non-text (3:1) tiers, scrim-aware compositing, and an APCA `Lc` readout (informational). Plus a shared **AA auto-fix / palette-derivation** helper (OKLCH/HCT, admin-only) used by color-system (C6/C7), presets (#5/#9/#12), branding (B7), accessibility (A7), and every dark-set (C8/A18). One `ContrastReport` matrix, extended in place.
5. **Focus-indicator token group** — `--wz-focus`, `--wz-focus-width`, `--wz-focus-offset`, `--wz-focus-ring`, `--wz-focus-glow` + a forced-colors outline fallback. Consumed by inputs, buttons (B10), rating, links, error-summary. Unify glow/error/rating (E2/A8/A13).
6. **Curated inline-SVG icon maps** — one pattern (enum → SVG template, `currentColor`, `aria-hidden`) already proven by `BUTTON_ICONS`. Reuse for input icons (I4), ending icons (E1/E2), error/success glyphs (I14/E9), spinner (B2/E5), share icons (E8), select chevron (I15), patterns/noise (E3/E11 as `data:` URIs). No per-icon CSS.
7. **`data-*` host-attribute reflection helper** — the existing `reflectAttr` pattern in `updated()`. Every layout-mode enum (card-pos, layout, align, page-fill, scrim-shape, stack, mobile, width-mode, cover-blur, btn-variant, focus, entrance, scheme, ending-align) reflects via this one helper, always skipping the "today" default so un-themed forms reflect nothing.
8. **Inert gradient/scrim/pattern composer** — the audited `pageBackground()`/`safeCssUrl` posture (SDK builds every `linear-gradient`/`url()`/SVG `data:` from hex+enum+bounded numbers). Reuse for button gradient (C9/B6), card gradient (E15), scrim tint/vignette (E4/E12), patterns/noise (E3/E11).
9. **Bounded-input → CSS-value mappers** — enum→weight (400/500/600/700), enum→cubic-bezier, enum→duration, enum→radius, ratio-string→number. Centralize so no raw value ever reaches CSS as text.
10. **Section/group block + fieldset a11y** — the `section` content block (layout 7, background E10) and the radio/checkbox `<fieldset>/<legend>` fix (A3) share one grouping render convention over the flat field array.
11. **Theme wire format** — `themeFileSchema` = `appearanceSchema` envelope, shared by export/import (#3), My-Themes (#7), and account Brand Kit (#11).

---

## 3. Bundle-size budget (32 KB widget)

Most enrichments are **CSS/token additions or admin-only** and cost near-zero widget bytes. Guard the budget with these rules:

**Cheap / negligible (do freely):** all `--wz-*` token additions and `color-mix`/`clamp`/`calc` derivations; `data-*` attribute-gated rule blocks; enum→value maps; `accent-color`/`::selection`/`::placeholder`/`:-webkit-autofill`/forced-colors/reduced-transparency CSS; reflection via the existing helper. These are the bulk of P0 across sections.

**Attribute variants over per-variant CSS (mandatory pattern):** input variants (I12), button variants (B1), focus styles, card positions, ending states — all use the shipped `--_fill/--_bw/--_r` token-flip + one shared rule, gated by a `data-*` attribute. Never emit a full CSS block per merchant choice.

**Meaningful widget weight — keep lean or lazy:**
- **Curated SVG icon maps** (I4 input icons, E1/E2 ending icons, E8 share, B2/E5 spinners, I15 chevron, E3/E11 pattern/noise generators). Each glyph is bytes; cap the curated sets, share one template renderer, and prefer `currentColor`. Pattern/noise SVGs are generated on demand from templates — no static asset library.
- **R8 embed auto-resize** — a `ResizeObserver` + `postMessage` handler; small but the only always-loaded JS addition. Keep it a no-op branch when not iframed.
- **E14 scroll-reveal (IntersectionObserver)** and **E13 confetti** — explicitly deferred/lazy; only instantiate the observer/particles when the feature flag is on.
- **B12 multi-step nav** — meaningful render + state logic; gated on the pages engine, not shipped early.
- **Web fonts (T3/T8)** load at document scope via `<link>` (not counted against the 16/32 KB JS budget), but **widening `GOOGLE_FONT_HREF` weight axes adds metadata KB per family** — keep to a consistent `wght@400;500;600;700` (serifs `400;600;700`) and lazy-load only the selected family (and ≤2 for pairing).

**Admin-only (zero widget cost):** all of presets-themes (#1–#9, #11–#12), palette/brand-kit extraction (C6/C7/B7/#5), OKLCH/HCT/quantization utilities, `theme-extract.ts`, `ContrastReport`/APCA. Never import these into `packages/forms-sdk`.

**Net:** the entire P0 wave is essentially free (tokens + attribute CSS + renderer a11y fixes). Watch the budget only at the icon-map growth (I4/E1/E8) and the two observer-based P1/P2 features (R8, E14).

---

## 4. Phased build order mapped to files

### Wave 0 — shared substrate (unblocks everything)
- **theme.ts**: role-token refactor for typography (`--wz-fs-*`), per-state color engine (C2/C3 tokens), motion token set (`--wz-dur-fast/base/slow`, easing map), shadow scale extension, focus-indicator token group. **form-renderer.ts**: `.rf-bg` image layer (background), `.rf-cq` named container (R1), refined reduced-motion contract (E12), reflection helper generalized.

### Wave 1 — P0 across sections (mostly free, highest payoff)
- **form-renderer.ts** (a11y + correctness, largely no-schema): A1–A4, A6, A8 (live regions, focus mgmt, group semantics, forced-colors, `.rf-sr`); I1 autofill fix; B2 loading a11y + spinner; B3 touch height; layout-7 fieldset fix; R2/R3/R4/R9 (mobile bleed, touch floor, cqi gutter, overflow); E1/E2 focus offset+unify; E5 submit spinner; ending E1–E4 structured panel + per-state copy + redirect delay.
- **theme.ts**: C1 accent/selection; C4 placeholder/link; typography T1/T2/T4 (pairing, scale, line-height); layout-2/3/4/5 tokens; background E1a/E1b/E2a; B1 variant; focus E3/E4; branding B1/B2 logo.
- **form-schema.ts**: declare all Wave-1 enums/keys (`.strict()`): `colors.success/link`, `headingFont/bodyFont/scaleRatio/lineHeights`, `inputPadX/cardPadding/columnGap/contentAlign/layoutMode/fluidWidth/columns'3'/span`, `inputSize`, `buttonVariant/buttonLoader`, `cardPosition/imageBrightness…/FORM_SHADOWS`, `focusOffset/motionSpeed/easing/submitLoader`, `endings` object, `logo.*`, `responsive` object (`mobileLayout/touchTargets/pagePadding`), `a11y.underlineLinks/errorIcon`.
- **DesignSettings.tsx**: new panels — **Motion**, **Responsive**, **Accessibility**, **Ending screen**; extend Colors/Inputs/Buttons/Layout/Background panels; A7 contrast engine upgrade + focus pair in `ContrastReport`.
- **presets.ts**: thumbnails (#2), categories/industries (#1), export/import (#3) — admin-only, can proceed in parallel.

### Wave 2 — P1 expressive polish
- **theme.ts / form-renderer.ts**: T3 weights (+`GOOGLE_FONT_HREF` widening), T5/T6 tracking/case, T8 library; C8 dark mode, C9/B6 gradients, B4/B5/B7/B8/B9/B10; E3/E4/E5/E6/E7/E8 background; E6–E11 entrance/skeleton/checkmark/underline focus/focus color; ending E5–E9/E16; branding B3/B4/B6/B7; R5/R6/R7/R8/R10; a11y A9–A15.
- **form-schema.ts**: declare all P1 keys. **DesignSettings.tsx**: corresponding controls + apply-mode (#8), brand-kit (#5), source-color (#9).

### Wave 3 — P2 / gated
- Presets SDK dark mode (#10) [needs schema+SDK], account brand-kit (#11); layout/background section blocks & split-screen (7/E9/E10); buttons multi-step nav (B12, gated on pages engine); ending conditional/piping (E11–E15); branding hero/social; focus-motion confetti/scroll-reveal; responsive sticky/cqi-media (R11–R13); a11y A16–A19.
- **Hosted-route (Next `<head>`) + public-schema read path**: favicon (B5), OG/share (B11), powered-by plan clamp (B4).

---

## 5. Database columns required

**None.** Every enrichment in this catalog lands in the existing `appearance_json` JSON column (global keys, all additive and `.strict()`-declared with today's-value defaults), the existing `schema_json` per-field props (`field.style.*`, per-field `span`/`readOnly`/`prefixIcon`/`rows`), or the `endings` object nested in `appearance_json` (chosen precisely because `successMessage`/`redirectUrl` are the only scalar columns and adding scalar siblings would require a migration). Explicitly no-migration paths worth flagging:

- **Ending content/behavior** → `appearance.endings` (not new scalar columns).
- **"My Themes" / account Brand Kit (#7/#11)** → localStorage v1, then an **existing** account/settings JSON column if one exists — never a new table.
- **`expired` state (E11)** → needs a backend `FormsClientError` *reason* flag (not a column) plus a new `Status`/`PreviewState` enum value in the SDK.
- **Powered-by plan gating (B4)** → enforced in the existing public-schema read path (server clamp), not stored.

If a form ever gains a `config_json` column later, ending content can migrate there transparently — the schema shape is identical either way. Until then, zero migrations are needed for the full catalog.