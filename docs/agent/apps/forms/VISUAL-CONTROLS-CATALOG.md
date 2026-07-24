I have full grounding: the `appearance` schema (`.strict()`, JSON column, hex-only colors, enum fonts, https-only assets), `themeVars()` emitting a `:host` `--wz-*` block inlined per instance, `baseStyles` with `container-type: inline-size` and `all: initial` already set, host attribute reflection already used (`data-label='left'`), and the admin `DesignSettings.tsx` using Orion `Collapse / ColorPicker / Segmented / Select / Slider / Switch / Card / Input`. Here is the catalog.

---

# Form Builder — New Visual Controls Catalog

Grounding facts that shape every proposal below:

- **No migration, ever.** `appearance` lives in `appearance_json`; fields in `schema_json`. New keys = pure Zod additions. But `appearanceSchema` is `.strict()`, so every new global key **must** be added to the schema or parsing rejects it.
- **Security invariant (do not break):** merchant values reach the widget only as (a) hex via `hexColor`, (b) enum members, (c) `https://` asset URLs via `httpsAssetUrl`, or (d) bounded numbers. They enter as **CSS custom-property values** (`themeVars()` string) or **reflected host attributes** — never as stylesheet source text. No image-accepting property ever receives a merchant-authored `url()`; the component builds every `url()` itself. This is why gradients (no URL, inert) are cheap and raw background-image strings are forbidden.
- **Backward-compat rule:** every new token defaults to today's baked-in value, so `themeVars(undefined)` and any pre-existing form render identically.
- **Container queries are already available** (`:host { container-type: inline-size }`) — multi-column needs no new plumbing.
- **Variant-attribute pattern already exists** (`data-label='left'` reflected to host) — reuse it for new variants.

Naming: global tokens are added under `appearance.*` and drive `--wz-*`; per-field props are added to `baseFieldShape` (all fields) or a specific field schema.

---

## TIER 1 — Do next (high impact-to-effort, no deps, no migration)

### 1.1 Page background: gradient + image + overlay scrim
**What / who:** A styled area *around* the card (today only a flat `pageBackground` hex). Adds an optional linear/radial gradient, an optional hosted background image, and a contrast scrim over it. Typeform (background image + brightness + fullscreen/repeat), Jotform (page image, gradient start/end, blur/overlay effects), Paperform (bg image/video + overlay), Fillout (position layouts over image).
**Scope:** Global — `appearance.background`.
**Schema addition:**
```
// new: appearance.background (optional; absent = today's flat pageBackground)
const FORM_BG_TYPES = ['solid','gradient','image'] as const;
const FORM_GRADIENT_DIRS = ['to bottom','to top','to right','to bottom right','radial'] as const;
appearanceBackgroundSchema = z.object({
  type: z.enum(FORM_BG_TYPES).default('solid'),
  gradientFrom: hexColor.optional(),
  gradientTo:   hexColor.optional(),
  gradientDir:  z.enum(FORM_GRADIENT_DIRS).default('to bottom'),
  imageUrl:     httpsAssetUrl.optional(),        // reuse existing https-only asset validator
  imageFit:     z.enum(['cover','contain','repeat']).default('cover'),
  scrim:        z.number().min(0).max(0.8).default(0), // overlay opacity; 0 = none
}).prefault({})
```
Add `background: appearanceBackgroundSchema` to `appearanceSchema`. Default `type:'solid'`, `scrim:0` ⇒ unchanged.
**Tokens:** `--wz-page-bg-image` (gradient string **or** component-built `url("…")`), `--wz-page-scrim`. `themeVars()` composes the gradient string from `gradientFrom/To/Dir` (pure CSS function, no URL, inert). For `type:'image'`, the SDK — **not the merchant** — writes `url("${imageUrl}")` only after re-confirming `https://` + no `)`/`,`/whitespace, exactly the posture of logo/cover today. Scrim is a `linear-gradient(rgba(0,0,0,scrim),…)` layer painted above the image; contrast comes from the scrim, not blur.
**SDK render:** `.rf-root { background: var(--wz-page-bg-image, var(--wz-page-bg)); }` with a scrim pseudo-layer. Gradients need zero new security review; image path reuses the audited `httpsAssetUrl` flow. Optionally clamp scrim ≥0.35 when an image is set to protect WCAG 4.5:1.
**Admin:** `Segmented` (solid/gradient/image) → conditional `ColorPicker`×2 + `Select` (direction) / existing `AssetInput` + `Segmented` (fit) + `Slider` (scrim 0–0.8).
**Impact:** High (single biggest "designed vs. default" lever). **Effort:** M.

### 1.2 Input style variant — outlined / filled / underlined
**What / who:** Global look of every input/select/textarea. Fillout (Input style variants, Advanced designer), Material 3 (`outlined`/`filled`), Webflow/Framer (built manually). Today all inputs are outlined-only.
**Scope:** Global — `appearance.layout.inputVariant`.
**Schema addition:**
```
FORM_INPUT_VARIANTS = ['outlined','filled','underlined'] as const;
// inside appearanceLayoutSchema:
inputVariant: z.enum(FORM_INPUT_VARIANTS).default('outlined'), // = today
```
**Attribute:** reflect to host as `data-input='filled|underlined'` (mirrors existing `data-label` pattern). `outlined` = no attribute (today's rules).
**SDK render:** one rule block driven by private tokens, per the research §3 pattern — only the differing tokens flip:
```
input,select,textarea { background:var(--_fill,var(--wz-surface));
  border:var(--_bw,1px) solid var(--_bc,var(--wz-border)); border-radius:var(--_r,var(--wz-radius)); }
:host([data-input='filled'])     { --_fill:var(--wz-subtle); --_bw:0; }
:host([data-input='underlined']) { --_bw:0; --_r:0; /* + border-bottom:2px */ }
```
No new colors, no security surface (attribute enum only). Keeps focus/hover/error rules shared.
**Admin:** `Segmented` (Outlined / Filled / Underlined) in a new "Inputs" collapse panel.
**Impact:** High (instantly reads as a different, intentional design language). **Effort:** S.

### 1.3 Layout content blocks — heading / divider / paragraph / image
**What / who:** Non-input display elements placed between fields. Tally (`/h1-3`, `/divider`, images), Jotform (Header, Paragraph, Divider, Image), Paperform (text/image/section breaks), Fillout (HTML/CSS fields, image blocks), Google Forms (images between questions).
**Scope:** Per-field — new members of the discriminated union (they occupy the ordered `schema_json` array, render inline, collect no data).
**Schema addition:** add `'heading','divider','paragraph','image_block'` to `FORM_FIELD_TYPES` and to `formFieldSchema`:
```
headingFieldSchema = z.object({ key, type:z.literal('heading'),
  text:z.string().min(1).max(255), level:z.enum(['h2','h3']).default('h2') });
dividerFieldSchema = z.object({ key, type:z.literal('divider') });
paragraphFieldSchema = z.object({ key, type:z.literal('paragraph'),
  text:z.string().min(1).max(2000) });          // rendered as textContent, never innerHTML
imageBlockFieldSchema = z.object({ key, type:z.literal('image'),   // display image
  url:httpsAssetUrl, alt:z.string().max(255).optional() });
```
(These skip `label/required/validation`; keep `key` + `width` so they honor half-width and the uniqueness check. Backend submission validator must skip them — they have no `data_json` entry.)
**Tokens:** none new; reuse `--wz-fg/--wz-muted/--wz-border/--wz-gap`.
**SDK render:** `heading`→`<h2/h3>`; `divider`→`<hr>` using `--wz-border`; `paragraph`→`<p>` set via **`textContent`** (no HTML injection); `image`→`<img src>` reusing the audited https asset flow, `loading="lazy"`, `max-width:100%`.
**Admin:** these become new items in the field-type palette; property panel uses `Input`/`Input.TextArea`/`Select`/`AssetInput`.
**Impact:** High (turns a flat field list into a structured, branded page). **Effort:** M (touches palette + submission validator's "collectable field" filter).

### 1.4 Floating labels
**What / who:** Label rests inside the input, animates up on focus/fill. Material 3, uxpatterns.dev; a signature "modern form" look.
**Scope:** Global — extend the existing enum.
**Schema addition:** add `'floating'` to `FORM_LABEL_POSITIONS` (`['top','left','floating']`). Default stays `'top'`.
**Attribute:** reflect `data-label='floating'` (reuses the exact mechanism already wired in `updated()`).
**SDK render:** label absolutely positioned over the input; `:host([data-label='floating']) input:focus + label, input:not(:placeholder-shown) + label { transform:…; font-size:… }`. Transition uses the motion tokens from 1.7 so it respects `prefers-reduced-motion`. Purely CSS/attribute — no security surface.
**Admin:** add "Floating" segment to the existing Label position `Segmented`.
**Impact:** Medium-High. **Effort:** S.

### 1.5 Button size + optional leading icon
**What / who:** Button height/padding scale and an optional glyph. Tally (button height/font size), Fillout (button size), Paperform (button typography/shape). Today only shape/full-width/align exist.
**Scope:** Global — `appearance.layout`.
**Schema addition:**
```
FORM_BUTTON_SIZES = ['sm','md','lg'] as const;
FORM_BUTTON_ICONS = ['none','arrow','check','send'] as const; // curated glyphs, no URL
buttonSize: z.enum(FORM_BUTTON_SIZES).default('md'),   // md = today
buttonIcon: z.enum(FORM_BUTTON_ICONS).default('none'),
```
**Tokens/attr:** `--wz-btn-pad-y` / `--wz-btn-font` driven by size; icon rendered from an inline curated SVG map keyed by the enum (never a URL).
**SDK render:** `.rf-submit` reads the new tokens; icon is a hardcoded `<svg>` chosen by enum — zero injection surface.
**Admin:** `Segmented` (S/M/L) + `Select` (icon).
**Impact:** Medium. **Effort:** S.

### 1.6 Field spacing fine-tune (row gap + input padding)
**What / who:** Numeric control over vertical gap between fields and input inner padding, independent of the 3-step density preset. Tally (bottom margin, horizontal padding), Elementor (Rows Gap, Text Indent), Jotform (question spacing).
**Scope:** Global — `appearance.layout`.
**Schema addition:**
```
fieldGap:   z.number().int().min(6).max(40).optional(),  // overrides density gap
inputPadY:  z.number().int().min(4).max(18).optional(),  // overrides density padY
```
**Tokens:** if set, override `--wz-gap` / `--wz-pad-y` (which density otherwise supplies). Absent ⇒ density wins ⇒ unchanged.
**SDK render:** already fully token-driven; just let `themeVars()` prefer the explicit value.
**Admin:** two `Slider`s (shown as "advanced" under density).
**Impact:** Low-Medium (polish + differentiation from the 3 presets). **Effort:** S.

### 1.7 Focus-ring style + motion tokens
**What / who:** Choose how focus is drawn (ring / border / glow) and gate transitions behind reduced-motion. Webflow/Framer (focus states, glow), uxpatterns.dev, Material.
**Scope:** Global — `appearance.layout`. Today `--wz-focus` is color-only.
**Schema addition:**
```
FORM_FOCUS_STYLES = ['ring','border','glow'] as const;
focusStyle: z.enum(FORM_FOCUS_STYLES).default('ring'), // 'ring' = today's outline+ring
focusWidth: z.number().int().min(1).max(4).default(2),
```
**Tokens/attr:** `--wz-focus-width`; reflect `data-focus='glow'` etc. Also add duration tokens `--wz-dur`/`--wz-ease` collapsed under `@media (prefers-reduced-motion: reduce)` (to `0.01ms`, preserving `transitionend`).
**SDK render:** `:focus-visible` block reads `--wz-focus` + `--wz-focus-width`; glow uses `box-shadow`, border uses `border-color`. Never remove the ring (WCAG). No security surface.
**Admin:** `Segmented` (focus style) + `Slider` (width). Motion is automatic; optionally a `Switch` "Enable subtle animations".
**Impact:** Medium (accessibility + polish differentiator; Wix/Elementor lack a per-field focus style). **Effort:** S.

### 1.8 Required-indicator style
**What / who:** Asterisk / "Required" text / none, positioned before or after the label. Wix (before/after), Paperform (show/hide), Globo, uxpatterns.dev.
**Scope:** Global — `appearance.layout` (style applies form-wide; per-field `required` boolean already exists).
**Schema addition:**
```
FORM_REQUIRED_MARKS = ['asterisk','text','none'] as const;
requiredMark: z.enum(FORM_REQUIRED_MARKS).default('asterisk'), // = today
```
**SDK render:** `.rf-label` renders `*` (in `--wz-error`), the word "Required", or nothing based on the enum. Pure text — no surface.
**Admin:** `Segmented` (Asterisk / Text / None).
**Impact:** Low-Medium. **Effort:** S.

---

## TIER 2 — Bigger, higher-value follow-ups

### 2.1 True multi-column layout (2 / 3 columns, responsive collapse)
**What / who:** Beyond today's `half`: a form-wide 2- or 3-column grid that collapses on narrow embeds. Jotform (Enable Columns + count), Tally (drag columns), Fillout (2-col + half-width), Paperform (2-col).
**Scope:** Global — `appearance.layout.columns` (`'1'|'2'|'auto'`), with existing per-field `width` still honored.
**Schema:** `columns: z.enum(['1','2','auto']).default('1')`. Reflect `data-cols`.
**SDK render:** `@container` queries already available; `.rf-fields { display:grid }` with `@container (min-width:34rem){grid-template-columns:1fr 1fr}`. Because `@container` can't read custom props, use discrete attribute-gated rules (research §4). No security surface.
**Admin:** `Segmented`.
**Impact:** High. **Effort:** M (interacts with the existing half-width pairing logic; need clear precedence).

### 2.2 Per-field style overrides
**What / who:** Let a single field opt out of the global variant/accent (e.g. a highlighted "email" field). Webflow (combo classes), Framer (per-instance). None of the whole-form tools (Wix/Elementor) do this well — a differentiator.
**Scope:** Per-field — optional `style` object on `baseFieldShape`.
**Schema:** `style: z.object({ inputVariant: z.enum(FORM_INPUT_VARIANTS).optional(), accent: hexColor.optional() }).optional()`.
**SDK render:** apply as an inline `style="--wz-border:…"` **scoped to that field's element** via `setProperty` (confined value, safe). Attribute variant set per-field-wrapper.
**Admin:** collapsible "Advanced style" section in each field's property panel (`Segmented` + `ColorPicker`).
**Impact:** Medium. **Effort:** M/L.

### 2.3 Per-field adornments — prefix/suffix, help text, character counter
**What / who:** Static `$`/`@`/`.com`, supporting text below the field, and `used/limit` counters. Material 3, uxpatterns.dev; none of the current builders expose all three natively.
**Scope:** Per-field — `baseFieldShape` additions.
**Schema:**
```
prefix:   z.string().max(8).optional(),
suffix:   z.string().max(8).optional(),
helpText: z.string().max(200).optional(),
showCounter: z.boolean().default(false), // only meaningful with a maxLength
```
**SDK render:** prefix/suffix as flanking spans (text-only, `textContent`); help text as `<p>` wired to `aria-describedby`; counter reads the live value length vs. `validation.maxLength`, color-shifts near the limit. No security surface (all text nodes).
**Admin:** `Input`/`Input.TextArea`/`Switch` in field property panel.
**Impact:** Medium-High (real usability + polish). **Effort:** M.

### 2.4 Micro-animations / transitions toggle
**What / who:** Border/label/underline eased transitions on focus & entrance. Fillout (animation choice), Framer (variant transitions), PixelFreeStudio guidance.
**Scope:** Global — `appearance.layout.animations: z.boolean().default(false)` (off = today).
**SDK render:** enables the `--wz-dur` transitions from 1.7; strictly gated by `prefers-reduced-motion`. No security surface.
**Admin:** `Switch`.
**Impact:** Medium. **Effort:** M.

### 2.5 Progress-bar styling (forward-looking, for multi-step)
**What / who:** Show/hide + percentage vs. stepped. Typeform (percentage/proportion), Fillout (default vs. multi-step), Tally (on/off), Paperform.
**Scope:** Global — `appearance.progress: { show:boolean, style:'percentage'|'steps' }`.
**Note:** Ship the tokens/rendering now (single-step no-op) so multi-step later is free. `--wz-primary` drives the fill.
**Impact:** Medium (only once multi-page lands). **Effort:** M — **defer until multi-step exists**.

### 2.6 Frosted card / backdrop blur over background image
**What / who:** `backdrop-filter: blur()` on the card when a page image is set. Jotform (blur effect), Paperform (overlay blur). Pairs with 1.1.
**Scope:** Global — `appearance.background.cardBlur: z.number().min(0).max(20).default(0)`.
**SDK render:** `backdrop-filter: blur(var(--wz-card-blur))`; progressive enhancement layered over the always-on scrim (contrast never depends on blur). GPU cost noted; clamp radius. No security surface.
**Impact:** Medium (premium aesthetic). **Effort:** M.

---

## TIER 3 — Advanced / defer

### 3.1 Raw custom CSS behind an AST allowlist
Jotform/Tally/Fillout/Paperform all gate this behind paid tiers — and all document it as unsupported/foot-gun. Our security model forbids stylesheet-source text from merchants outright. If ever needed, parse with a CSS AST, allowlist a fixed property set, **strip every `url()`/`image-set()`/`@import`/`@font-face`**, and re-serialize — never pass the string through. High risk, high effort. **Defer.**

### 3.2 Video backgrounds
Jotform/Paperform offer YouTube bg video. Network fetch + third-party origin + perf + autoplay a11y. Conflicts with our no-off-origin-fetch posture. **Defer.**

### 3.3 Full per-state input styling matrix
Material/Setproduct expose `default·hover·focus·filled·error·success·disabled` color matrices. We already ship hover/focus/error. A full editable matrix is a large admin surface for marginal gain. **Defer** (keep the curated built-in states).

### 3.4 Custom font upload
Fillout/Paperform allow `@font-face` upload. Breaks the enum-only, no-dynamic-URL font posture (`GOOGLE_FONT_HREF` is fixed-keyed today). **Defer**; if demanded, route through a hosted, validated font pipeline with fixed origins.

### 3.5 Per-question image layouts (stack / split / float / wallpaper)
Typeform's signature, tied to a one-question-per-screen engine we don't have. Large. **Defer** until/unless a guided-mode engine is built.

---

## Impact × Effort summary

| # | Control | Scope | Impact | Effort |
|---|---|---|---|---|
| 1.1 | Page bg gradient/image + scrim | global | High | M |
| 1.2 | Input variant outlined/filled/underlined | global | High | S |
| 1.3 | Content blocks (heading/divider/paragraph/image) | per-field | High | M |
| 1.4 | Floating labels | global | Med-High | S |
| 1.5 | Button size + icon | global | Med | S |
| 1.6 | Field spacing fine-tune | global | Low-Med | S |
| 1.7 | Focus-ring style + motion tokens | global | Med | S |
| 1.8 | Required-indicator style | global | Low-Med | S |
| 2.1 | Multi-column 2/3 (@container) | global | High | M |
| 2.2 | Per-field style override | per-field | Med | M/L |
| 2.3 | Prefix/suffix, help text, counter | per-field | Med-High | M |
| 2.4 | Micro-animations toggle | global | Med | M |
| 2.5 | Progress-bar styling | global | Med | M (defer) |
| 2.6 | Frosted card / backdrop blur | global | Med | M |

---

## Recommended next build (the Tier-1 set, in order)

Implement these directly — all are additive Zod keys on `appearanceSchema`/`baseFieldShape` (no migration), all default to today's look, and each maps to an existing Orion control in `DesignSettings.tsx`:

1. **Input style variant** (1.2) — biggest visual payoff per line of code; one enum + one reflected `data-input` attribute + one token-flip rule block. `Segmented`.
2. **Page background gradient + image + scrim** (1.1) — the top "designed vs. templated" lever; gradients are free and safe, image reuses the audited `httpsAssetUrl` flow. `Segmented` + `ColorPicker` + `AssetInput` + `Slider`.
3. **Content blocks: heading / divider / paragraph / image** (1.3) — structure and brand storytelling; the one item that also touches the palette + submission validator, so schedule its integration test early.
4. **Floating labels** (1.4) — one enum member on `FORM_LABEL_POSITIONS`, reuses the existing `data-label` reflection.
5. **Focus-ring style + reduced-motion tokens** (1.7) — polish + an accessibility differentiator Wix/Elementor lack.
6. **Button size + icon** (1.5), **required-indicator style** (1.8), **field-spacing fine-tune** (1.6) — three small `Segmented`/`Slider`/`Select` additions that round out the panel.

Each reference product justifying these: input variants (Fillout, Material 3); background image/gradient/scrim (Typeform, Jotform, Paperform, Fillout); content blocks (Tally, Jotform, Paperform, Google Forms); floating labels (Material 3, uxpatterns.dev); focus-ring/motion (Webflow, Framer, uxpatterns.dev); button size/icon (Tally, Fillout, Paperform); required-mark (Wix, Paperform, Globo); field spacing (Tally, Elementor, Jotform).

Relevant files for implementation: `/home/eeshu/Desktop/ratio-apps-form-builder/packages/shared/src/schemas/form-schema.ts` (schema), `/home/eeshu/Desktop/ratio-apps-form-builder/packages/forms-sdk/src/ui/theme.ts` (`themeVars()` + `baseStyles` tokens), `/home/eeshu/Desktop/ratio-apps-form-builder/packages/forms-sdk/src/ui/form-renderer.ts` (render + host-attribute reflection + submission-field filtering for 1.3), `/home/eeshu/Desktop/ratio-apps-form-builder/apps/admin-forms/src/components/DesignSettings.tsx` (Orion controls).