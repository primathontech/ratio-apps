This is a design-only consolidation task. The 15 specs are already provided in full — I don't need to read the repo. Let me synthesize the consolidated plan.

Let me produce the Markdown plan directly as my final output.

Since this is a consolidation of already-provided material into a deliverable plan, I'll write it out. The task asks for a Markdown consolidated plan with 4 sections. My output is returned verbatim, so I'll produce clean Markdown.

# Form Builder Field Enrichment — Consolidated Architecture Plan

## 1. Per-field P0 enrichments (the clear wins)

Each row is a P0 item: schema key(s) → SDK behavior → admin control → effort. All keys land in `schema_json`/`files_json` (JSON columns) → **no migration** except where explicitly flagged. Security envelope everywhere: enum / hex / https-asset / bounded-number / bounded-string only.

### text
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Format preset library + custom error | `validation.format: enum(FORM_TEXT_FORMATS)`, `validation.patternMessage: string.max(120)` | Resolve pattern from server-authored `FORM_TEXT_FORMAT_PATTERNS` map (or raw `pattern` for custom), construct `RegExp(src,'u')`, reflect to native `pattern=`, emit `patternMessage` on fail | `Select` (None/Letters/Alphanumeric/Slug/No-emoji/PIN/PAN/GSTIN/IFSC/Custom) + error-message `Input` | M |
| Value transform / normalize | `validation.transform: enum(none/trim/trim_upper/trim_lower/trim_title)` default `trim` | Apply on `blur` (UX mirror); **server authoritative** applies before length/pattern, returns canonical value | `Select` "Clean up input" | M |
| `autocomplete` attribute | `autocomplete: enum(FORM_AUTOCOMPLETE_TOKENS)` | Reflect to native `autocomplete=` | `Select` "Autofill" with human labels | S |
| Native length attrs + hard ceiling | `FORM_TEXT_HARD_MAX_LENGTH=1000`; `validation.maxLength.max(1000)` | Reflect `maxlength`/`minlength`; server enforces `min(maxLength, HARD_MAX)` always-on | `max=` on existing Max-length input | S (ceiling is the security fix) |

### textarea
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Auto-grow + min/max rows | `display.{minRows,maxRows,autoGrow}` (nested obj, self-refined) | `rows=minRows`, `field-sizing:content` + CSS clamp, graceful degrade | 2× `InputNumber` + `Switch` | M |
| Soft vs hard max length | `display.enforceMaxLength: bool` | Adds native `maxlength` when true; server already hard-enforces | `Switch` "Stop typing at max" | S |
| Counter unit (words) + min surfacing | `display.counterUnit: enum(characters/words)` | Word-count in `renderCounter`; show `min N` when only minLength set | `Segmented` | S |
| Monospace | `display.monospace: bool` | `data-mono` → curated network-free font stack | `Switch` | S |

All hang off one nested `textareaDisplaySchema` (keeps discriminated-union member a plain `ZodObject`).

### email
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Normalize + tighten + length cap + hints | `validation.maxLength.max(320)` default 254 | `trim().toLowerCase()`, tightened TLD regex, `autocomplete=email`/`autocapitalize=off`/`spellcheck=false`; **server returns canonical lowercased value** | (advanced) max-length input | S |
| "Did you mean" typo suggestion | `validation.suggestCorrections: bool` default true | Client-only edit-distance vs curated `FORM_EMAIL_SUGGEST_DOMAINS/TLDS`; non-blocking "Apply" hint; no network | `Switch` | M |
| Free-provider block | `validation.blockFreeProviders: bool` | Reject domain in curated `FORM_FREE_EMAIL_PROVIDERS`; **server-enforced** | `Switch` "Only business emails" | S |
| Domain allow/block list | `validation.allowedDomains[]`/`blockedDomains[]` (bare-hostname regex, mutually exclusive) | Membership check post-normalize; server-enforced | `Segmented` None/Allow/Block + domain-row editor | M |

New optional `validation` object on `emailFieldSchema` (was none). Build order E1→E4→E3→E5.

### phone
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Multi-country dial-code selector | `allowedCountries: enum[]`, `defaultCountry: enum` default `IN` (+refine) | Native `<select>` of `{flag}{dial}` when >1 country; submit composed E.164; single-country keeps static chip | `Select showSearch` (default) + `Select multiple` (allowed) | M |
| Per-country length + placeholder | (none — driven by `PHONE_COUNTRY_META` table) | `maxlength`/placeholder/length-validation from curated table | (auto) | S |

Ship P0-1+P0-2 as one unit; `+91`-only forms stay byte-identical. Table-driven, merchant picks enum only.

### dropdown
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Schema hardening | `optionsSchema`: `.max(MAX_OPTIONS=200)`, per-option `.max(200)`, dedupe `superRefine` | (validation only) | surface errors | S |
| Option-object refactor + value≠label | `optionSchema = union(string, {label,value?,description?,group?,emoji?,image?})` | Render `label`, submit `value`; **server membership → `optionValues()`** (also multi_select/radio) | "Advanced values" per-row `Input` | M |
| Default option | `defaultValue: string` (+refine ∈ options) | Seed `values[key]` at mount | `RadioGroup`/`Select` | S |
| Bulk add/paste | (none) | (none) | `TextArea` split-on-newline, dedupe, cap | S |
| Searchable typeahead | `searchable: bool` | ARIA combobox over listbox when set; native `<select>` stays default | `Switch` | M–L |

Keystone = option-object refactor; unlocks description/group/emoji/image across dropdown+radio+multi_select.

### multi_select
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Min/max selection count | `selection: {min?,max?}` (refined) | Count checks in validate; live "2 of 3"; **server-enforced** | 2× number `Input` | S |
| Server hardening | (none) | reject `len > options(+1)`, dedupe crafted POSTs | none | S |
| Display mode + columns | `display: enum(checklist/chips)`, `columns: int 1–3` | `data-cols` grid / chip toggles via tokens | 2× `Segmented` | M |
| Select-all / clear-all | `showSelectAll: bool` | Leading control row; hidden when `max` set | `Switch` | S |

### date
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Min/max + disable past/future | `validation.{min,max}: dateBoundSchema (mode none/today/fixed/offset)` | Resolve bounds vs one "today" snapshot → native `min`/`max`; **lexicographic ISO compare** replaces loose `Date.parse`; server re-resolves | `Segmented` bound-mode + `DatePicker`/offset input + "Disable past/future" `Switch`es | S–M |
| Default (today/fixed) | `defaultTo: enum(none/today)`, `defaultValue: isoDate` | Seed once at init if empty | `Select` + `DatePicker` | S |

Tighten the loose `Date.parse` to `isoDateSchema` even in the minimal slice (correctness fix). Document "today" timezone.

### file
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Selected-file UI (name/size/remove) | (none) | Chip row + Remove button after input | none | S |
| Image preview | `showPreview: bool` default true | Object-URL thumbnail for image mimes, revoke on clear/unmount | `Switch` | S |
| Drag-and-drop dropzone | (none) | `.rf-dropzone` with `data-dragover` token highlight; input stays click/a11y fallback | none | M |
| Multiple files + count | `FORM_FILE_MAX_COUNT=10`; `validation.{maxFiles,minFiles}` (refined) | `files: Record<key,string[]>`; `multiple`; loop presign per file; **touches `files_json` shape + submissions/webhook/CSV consumers (union legacy string)** | "Allow multiple" `Switch` + 2× `InputNumber` | L |
| Expand MIME allowlist | extend `FORM_FILE_ALLOWED_MIME_TYPES` (curated) | `accept=` auto-grows | checkbox list auto-grows | S |
| Upload progress | (none) | Switch `uploadFile` to XHR w/ `onprogress`; per-file bar; block submit until done | none | M |

Multi-file (P0-4) is the one structural change — sequence it alone.

### radio
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Layout (vertical/horizontal/grid) | `layout: enum`, `gridColumns: int 2–4` | `data-layout` + bounded `--rf-cols` (self-set, no merchant CSS) | `Segmented` + column count | S |
| Visual variant (list/button/card) | `variant: enum` default `list` | Keep real `<input>` for a11y, visually hide in non-list; `data-variant` + accent fill | `Segmented` | M |

Add option-value uniqueness `superRefine` (P0 hardening, unblocks default/meta). Shares option-object refactor with dropdown.

### checkbox
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Inline consent + `{link}` token | `consentText: string.max(500)` | Splice `<a>` at `{link}` via text nodes beside box; suppress redundant top label, keep `aria-label` | `TextArea` + helper | S |
| Second/third policy link | `links: [{text,url(https)}].max(3)` | Token-indexed `{link}`/`{link2}`/`{link3}` anchors | small repeater | S |

Both P0, no server/migration. `defaultChecked`+GDPR guardrail and export labels are P1.

### number
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Server-side `step` enforcement | (none — bug fix) | Mirror SDK step-multiple check on server | none | S |
| Display formatting | `format: {style enum, currency enum, grouping bool, locale enum, decimalPlaces int 0–10}` (refined) | Switch to `type=text`+`inputmode`; `Intl.NumberFormat` on blur, raw canonical on focus/submit; tabular-nums; server strips group sep + enforces decimals | Formatting divider: style/currency/locale `Select` + grouping `Switch` + decimals `InputNumber` + live preview | M |

`decimalPlaces` also delivers "N decimals" alone. Storage stays a JS number → CSV/webhook unchanged.

### url
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Require HTTPS | `validation.requireHttps: bool` | `new URL()` parse + protocol check both sides | `Switch` | S |
| Bounded maxLength | `validation.maxLength.max(2048)` default 2048 | `maxlength` attr + length check both sides | number `Input` | S |
| Bare-domain normalize + autocomplete + placeholder | (behavior) | Auto-prefix `https://` if schemeless, `autocomplete=url`; **both sides use `new URL()` on normalized candidate → fixes client/server drift; server returns normalized value** | (implicit) helper caption | S/M |

New optional `validation` object (was none). Replace static Alert with `UrlValidationSettings`. Ship the three as one PR.

### rating
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Low/High endpoint labels | `lowLabel`/`highLabel: string.max(48)` | Text-node ends row + group `aria-label` | 2× `Input` | S |
| Numbered-button scale + 0-based min | `display: enum(icons/buttons)`, `min: int 0–1` default 1 | Pill radios `min..max`; **server: `num < (field.min ?? 1)`; SDK mirror** — the one server-validation change | `RadioGroup` display + "Start at" 1/0 | M |

E1+E2 = full Opinion-Scale/NPS capability; ship as pair.

### hidden
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Fallback / default | `fallback: string.max(2048)` | `value = resolved ?? fallback`; fixes required-hidden footgun | `Input` "Default value" | S |
| Multi-source resolution | `source: enum(url_param/cookie/referrer/landing_url/timestamp/constant)` default `url_param`, `paramName?`, `constantValue?`; consistency checks in **`formFieldsSchema.superRefine`** (not member — union safety) | `resolveHiddenValue()` switch; server hardens constant/timestamp | `Select` (source) + conditional inputs | M |
| Admin cleanup | (none) | (none) | gate Placeholder/Advanced-style off for hidden | S |

### content_blocks (heading/divider/paragraph/image)
| Enrichment | Schema key | SDK behavior | Admin control | Effort |
|---|---|---|---|---|
| Image align+size+caption+link | `align enum`, `size enum`, `caption str`, `linkUrl https` | `<figure data-align data-size>` + `<figcaption>` + guarded `<a>` (re-check `https://`) | `Segmented`×2 + `Input`×2 | M |
| Heading align+size+eyebrow | `size enum`, `align enum`, `eyebrow str.max(80)` | Decouple visual size from semantic `level`; `data-*` token map | `Segmented`×2 + `Input` | S |
| Paragraph alignment | `align enum` (markdown-lite is P1) | `data-align` → `text-align` | `Segmented` | S |
| Divider variants | `variant enum(line/dashed/dotted/spacer)`, `spacing int 0–80` | `data-variant` border-style / spacer height | `Segmented` + `InputNumber` | S |

Zero server-validation impact (blocks skipped by submission validator; enforced only at save-time union parse). Shared `FORM_BLOCK_ALIGNMENTS` underpins three.

---

## 2. Cross-cutting patterns — build ONCE, reuse everywhere

These recur across ≥3 field specs. Building them as shared primitives (not per-field copies) is the single biggest lever for consistency and for keeping future per-field work non-colliding.

**A. Option-object model + normalizer** — `optionSchema = union(string, {label, value?, description?, group?, emoji?, image?})`, `resolveOption()`/`optionValues()` (Zod-free, SDK-importable). Consumed by **dropdown, radio, multi_select**. Forces one coordinated server one-liner (`includes(value)` → `optionValues().includes(value)`) across all three cases + SDK. This is the keystone that unlocks value≠label, per-option description/emoji/image, and groups. Backward-compatible union (bare string = `{label:s}`). **Owner: shared, done deliberately as its own workstream.**

**B. Shared "Other" free-text option** — pattern appears in dropdown, radio, multi_select, checkbox. Shared shape: `allowOther: bool`, `otherLabel: string`, bounded `otherMaxLength` (≤255/500). Shared server rule: accept **at most one** non-member value iff `allowOther` and within length bound. It's the only pattern that loosens the closed-set guarantee — implement the server membership relaxation once as a helper so the bound is uniformly tight.

**C. Min/max selection** — multi_select (`selection`), and redirect checkbox-group requests here (checkbox spec's E6 explicitly hands off). One `{min?,max?}` refined sub-schema + one count-check helper (client + server). Radio/rating "count" is N/A; this is specifically the multi-value control.

**D. Options-with-description/image/emoji admin editor** — one antd component (per-row: label, value, description, emoji, image-URL, group) reused by dropdown/radio/multi_select, plus a **bulk-paste** mode (newline-split, dedupe, cap). Replaces three divergent `OptionsEditor` forks. Also carries inline bare-domain/URL validation reused by email/url list editors.

**E. Value transform / normalization enum** — text (`trim/upper/lower/title`), email (`toLowerCase`), url (`https://` prefix + `new URL()` canonicalization), hidden (`none/trim/lower/trim_lower`), phone (E.164), number (canonical). Build **one shared pure transform helper library** (Zod-free, imported by SDK + server so verdicts never drift). The recurring bug across specs is client/server divergence — a single shared module is the fix.

**F. Format/mask utility** — text presets (`FORM_TEXT_FORMAT_PATTERNS`), text input-mask (`#`/`A`/`*`), phone grouping mask, number `Intl` formatting. Common sub-pattern: derive a validation regex/formatter from a **server-authored** spec, apply `u` flag consistently, strip to canonical before persist. One mask→regex + one "format-on-blur/raw-on-focus" helper serve text-mask, phone-format, and number-format.

**G. Curated `autocomplete`/input-hint tokens** — `FORM_AUTOCOMPLETE_TOKENS`, `inputMode`/`spellcheck`/`autocapitalize` enums. Shared across text, email, url (and phone/number defaults). Put on `baseFieldShape` (or a shared mixin) rather than per-field, with sensible auto-defaults derived from field type/format.

**H. Bounded domain-token schema** — bare-hostname regex (no scheme/path), used by email allow/block lists and url allowlist. One `domainSchema` + one `matchesDomain(host, list)` helper (wildcard-aware), imported both sides.

**I. Shared https-anchor render helper** — safe `<a href target=_blank rel=noopener noreferrer>` with defensive `^https:` re-check, used by checkbox links, image-block link, url preview, paragraph markdown-lite links. One helper eliminates four copies of the sanitize-before-href guard.

**J. `data-*` → private-token CSS convention** — already the house style (`data-input`, `data-cols`). Formalize for all new enum-driven visual config (radio layout/variant, multi_select display/columns, block align/size, divider variant, rating size). Merchant enum → `data-*` attr → private `--wz-*` token; never a raw CSS string. This is the security backbone for every "appearance" enrichment.

**K. Hard length/array ceilings** — text (`FORM_TEXT_HARD_MAX_LENGTH`), url (2048), options (`MAX_OPTIONS`), multi_select array bound, file count/total. A uniform "always-on server ceiling even when unconfigured" posture (textarea already has it). Bundle these as one hardening pass.

---

## 3. Implementation strategy — refactor first, then batch

**Recommendation: (b) refactor to per-field modules FIRST, then run per-field work in parallel — but with three shared foundations extracted before the split.**

### Why (b) over (a)

The four touch-points are all **shared files**: `form-schema.ts` (one discriminated union), `form-renderer.ts` (`renderControl` + `validateField` switches), `schema-validator.service.ts` (`validateValue` switch), `builder.$formId.tsx` (`TypeSpecificSettings` switch). Every one of the 15 field workstreams edits all four. Under strategy (a) — "schema-for-all, then SDK-for-all, then admin-for-all" — each phase is a single-writer bottleneck on four files: 15 subagents serialize on the same switch statements, producing constant merge conflicts on adjacent `case` arms. Coordinated domain batches reduce *cross-domain* conflict but not *cross-field* conflict, which is the dominant collision here (the task's stated "shared-file conflict problem").

Strategy (b) pays a one-time refactor cost to make each field type a self-contained module, after which 15 per-field subagents touch **disjoint files** and never collide. Given the roadmap is explicitly per-field and ongoing, this amortizes immediately.

### Concrete refactor shape

Introduce a per-field-type module with a stable registration interface, and reduce each shared file to a thin registry that maps over modules.

```
packages/shared/src/schemas/fields/
  text/       schema.ts        (textFieldSchema + text-only consts/formats)
  email/      schema.ts
  ...one dir per type...
  registry.ts                  (imports each schema, builds the discriminatedUnion)

packages/forms-sdk/src/ui/fields/
  text/       render.ts, validate.ts
  ...
  registry.ts                  (type → {render, validate})

apps/backend/.../submissions/fields/
  text/       validate.ts
  ...
  registry.ts                  (type → server validate)

apps/admin-forms/src/routes/builder/fields/
  text/       settings.tsx
  ...
  registry.ts                  (type → settings panel component)
```

Each field module exports the four contracts:
- **schema**: its `ZodObject` member (must stay a plain object — nested `.refine`d sub-schemas only, per the discriminated-union constraint noted in nearly every spec).
- **render(field, ctx)**: replaces its `renderControl` case.
- **validate(field, value)**: shared signature used by BOTH the SDK client validator and the server validator where logic is identical (import the same pure function into both; the SDK adds UX-only mirrors, the server stays authoritative).
- **settings(field, dispatch)**: replaces its `TypeSpecificSettings` case.

The four shared files become registries: `formFieldSchema = discriminatedUnion('type', Object.values(registry).map(m => m.schema))`; `renderControl = registry[field.type].render(...)`; etc. The **cross-field `superRefine`** (uniqueness, hidden-source consistency) stays at the union/`formFieldsSchema` level — a small shared file every module is registered into.

**Extract these shared foundations before/with the split** (they are genuinely cross-field, §2): the option-object model + normalizer (A), the transform/normalize helper library (E), the mask/format util (F), the https-anchor render helper (I), the `data-*`/token convention (J), and the domain-token helper (H). Put them in a shared `fields/_shared/` (or `packages/shared`) so field modules import rather than duplicate.

### Risk / effort

- **Effort**: the refactor is mechanical but broad — moving ~15 cases out of each of 4 switches into modules + wiring 4 registries. Estimate a focused single-owner change (one PR per layer, or one coordinated PR) before any enrichment lands. Medium effort, low intellectual risk.
- **Risk**: (1) The discriminated union must remain a union of plain `ZodObject`s — the registry must not wrap members in `ZodEffects`; keep refines nested or at the `formFieldsSchema` level. (2) Behavior must be byte-identical post-refactor — gate with the existing `form-schema.test.ts`/`form-renderer.test.ts`/`schema-validator.test.ts` as a golden regression (no behavior change in the refactor PR). (3) Tree-shaking/bundle: keep field modules' Zod-free constants separate (the `form-adornments.ts` pattern) so the SDK bundle doesn't pull Zod. (4) One-time coordination cost is real but bounded and paid once.
- **Mitigation**: land the refactor as a **no-op, test-locked PR** first; only then fan out enrichments per field.

If the refactor cannot be scheduled, fall back to (a) **sequenced by layer with a single owner per shared file per wave**, accepting serialization — but this does not scale to the ongoing per-field roadmap and will re-incur conflict on every future field change.

---

## 4. Phased build order (P0 wave first) mapped to files

### Phase 0 — Foundation (blocks everything; single coordinated owner)
- **Module refactor** (if adopting (b)): registries across the four files. *Files:* `form-schema.ts`, `form-renderer.ts`, `schema-validator.service.ts`, `builder.$formId.tsx` → new `fields/` trees. Test-locked no-op.
- **Shared primitives**: option-object model + normalizer (A), transform helpers (E), mask/format util (F), https-anchor helper (I), domain-token helper (H), `data-*`/token convention (J). *Files:* `packages/shared/src/schemas/fields/_shared/`, `form-text-formats.ts`, `form-phone-countries.ts`, `form-email.ts` (all Zod-free, SDK-importable).

### Phase 1 — Security/hardening pass (cheap, high-trust, mostly standalone)
Bundle all always-on ceilings + parity fixes (pattern K):
- text hard-max ceiling; url maxLength bound; options `MAX_OPTIONS`+dedupe; multi_select array bound + dedupe; number **server step enforcement**; date tighten `Date.parse`→`isoDateSchema`; radio option-value uniqueness; text/email/url validator convergence.
- *Files:* each field's `schema.ts` + server `validate.ts` (or the shared switches under (a)).

### Phase 2 — P0 wave, field batches (parallelizable once Phase 0 lands)
Independent field modules, disjoint files, run concurrently:

**Batch 2a — no-server-change appearance/behavior (safest, highest volume):**
- textarea display bundle (E1/E2/E3/E5) · radio layout+variant · multi_select display+columns+select-all · file selected-UI+preview+dropzone+MIME+progress · content_blocks align/size/caption/link/divider/eyebrow · checkbox inline-consent+multi-link · text autocomplete+native-length+transform(client mirror) · number formatting · rating endpoint labels.
- *Files:* per-field `render.ts` + `settings.tsx` (+ `schema.ts` for keys); CSS in `form-renderer.ts` style block.

**Batch 2b — items that DO touch server validation (higher scrutiny, still disjoint per field):**
- text transform (authoritative) + format presets · email normalize+free-provider+domain-lists · phone multi-country (rewrites `case 'phone'`) · date min/max+default · url https+maxLength+normalize · rating min/buttons · multi_select min/max · number decimals/grouping strip · hidden fallback+multi-source.
- *Files:* per-field `schema.ts` + `validate.ts` (client+server) + `settings.tsx`. Each field's server change is isolated to its own `case`/module.

**Batch 2c — dropdown P0 (depends on Phase 0 option-object):**
- dropdown value≠label + default + bulk-paste + searchable; radio/multi_select inherit the option-object refactor. The **one coordinated server one-liner** (`optionValues()`) lands here across the three option-based fields.

### Phase 3 — Structural / flagged (own tracked changes, not parallel with their field's P0)
- **file multi-file (P0-4)**: reshapes `files_json` + submissions/webhook/CSV consumers. Solo workstream, legacy-string union on all read paths.
- **hidden provenance (E8, flagged)**: needs `contextJson` migration — the **only migration in the plan**; schedule post-hidden-P0.
- **content_blocks markdown-lite** (P1) and **rating half-star** (P1, second server-validation touch) as deliberate follow-ups.

### Phase 4 — P1/P2 fast-follows
Per-field P1s (email confirm, phone extension/mask/mobile-only, dropdown descriptions/groups/images, date time/weekdays, checkbox defaultChecked+export-labels, number slider/stepper, url domain-allowlist/preview, rating icons/labels/emoji/images, hidden allowlist/normalize, text input-mask). All slot into existing per-field modules with no new shared work.

**Critical path:** Phase 0 → Phase 2c (option fields) and Phase 3 (multi-file) are the only true sequencing constraints; everything else in Phase 2 fans out freely once the module refactor and shared primitives exist.