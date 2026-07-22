// Type-only shapes of the shared form-schema contract (no Zod in the bundle).
import type { FormAppearance, FormField } from '@ratio-app/shared';
// Adornment capability matrix (§2.3) — the single source of truth shared with
// the admin builder, so the two never drift over which types get chips/counters.
import {
  FORM_ADORNABLE_FIELD_TYPES,
  FORM_COUNTER_FIELD_TYPES,
  isAdornable,
  supportsCounter,
} from '@ratio-app/shared/schemas/form-adornments';
import {
  css,
  html,
  LitElement,
  nothing,
  type PropertyValues,
  svg,
  type TemplateResult,
  unsafeCSS,
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getAnonId } from '../anon-id';
import { FormsClient, FormsClientError, type PublicFormSchema } from '../client';
// Per-field module registry (Phase 0 refactor): renderControl + validateField
// dispatch through this map. Zod-free (only lit + type-only shared imports).
import { fieldControls } from './fields/registry';
import type {
  ContentBlockField,
  ControlField,
  FieldControlModule,
  FieldRenderCtx,
  FieldValidateCtx,
} from './fields/types';
import { baseStyles, customGoogleFontHref, GOOGLE_FONT_HREF, sanitizeFontName, themeVars } from './theme';

/** Defensive hex re-check for the per-field accent (§2.2); the schema already
 * guarantees hex, so this only confines what reaches the inline style. */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Delay before following a form's redirectUrl, so the success state is seen. */
const REDIRECT_DELAY_MS = 1500;

type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'closed' | 'unavailable' | 'error';

// Content blocks (§1.3): display-only, submit no value, carry no label. The
// ContentBlockField type is owned by ./fields/types (shared with the registry).
// Kept local (not imported from shared) so no Zod reaches the browser bundle;
// mirrors the shared FORM_NON_COLLECTABLE_FIELD_TYPES contract.
function isContentBlock(field: FormField): field is ContentBlockField {
  return (
    field.type === 'heading' ||
    field.type === 'divider' ||
    field.type === 'paragraph' ||
    field.type === 'image'
  );
}

// Group fields (§P2-7): render a role=radiogroup/group <div>, not a labelable
// control, so the question binds via aria-labelledby on the group (mirrored in
// each group's render.ts) instead of an inert <label for> pointing at a div.
const GROUP_FIELD_TYPES = new Set<FormField['type']>(['radio', 'multi_select', 'rating']);

// Curated leading-glyph SVGs for the submit button (§1.5), keyed by the shared
// FORM_BUTTON_ICONS enum. Static markup only — never a merchant-supplied URL.
const BUTTON_ICONS: Record<'arrow' | 'check' | 'send', TemplateResult> = {
  arrow: svg`<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  check: svg`<path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  send: svg`<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
};

/** The subset of states the admin preview can request via `previewState`. */
export type PreviewState = 'ready' | 'success' | 'error' | 'closed';

/** Registered tag name — exported so the admin package can register/query it. */
export const RATIO_FORM_TAG = 'ratio-form';

declare global {
  interface Window {
    grecaptcha?: {
      ready(cb: () => void): void;
      execute(siteKey: string, opts: { action: string }): Promise<string>;
    };
  }
}

/**
 * `<ratio-form form-id="...">` — the storefront form renderer (PRD
 * "Storefront SDK", TDD §6).
 *
 * Fetches the render schema, renders every field type, validates
 * client-side with the same rules the backend re-checks, lazy-loads
 * reCAPTCHA v3 only when the form actually uses it, runs the presigned
 * upload flow for file fields, disables submit after the first click, and
 * renders the success / "form closed" / "no longer available" states.
 */
@customElement('ratio-form')
export class RatioForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      /* Outer wrapper carrying the page color; the card centers on top. The
         scrim ::before layer sits over the image for contrast (§1.1). */
      .rf-root {
        position: relative;
        background-color: var(--wz-page-bg);
        background-image: var(--wz-page-bg-image);
        background-size: var(--wz-page-bg-size);
        background-repeat: var(--wz-page-bg-repeat);
        background-position: center;
        /* §3 — backdrop breathes above/below the card; 0 when transparent. */
        padding-block: var(--wz-page-pad);
      }
      .rf-root::before {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--wz-page-scrim);
        pointer-events: none;
      }
      /* The professional default: a centered card carrying the theme surface,
         border, and shadow. Logo/cover/heading sit above the fields. Positioned
         so it stacks above the page scrim. */
      .rf-card {
        position: relative;
        background: var(--wz-bg);
        color: var(--wz-fg);
        padding: var(--wz-card-pad);
        border: var(--wz-card-border);
        border-radius: var(--wz-radius);
        box-shadow: var(--wz-card-shadow);
        max-width: var(--wz-max-width);
        margin: 0 auto;
        box-sizing: border-box;
      }
      /* §2.6 — frosted card over an image backdrop (gated by data-card-blur,
         set only when a background image + blur radius are configured).
         Progressive enhancement: contrast still comes from the always-on
         scrim, so a browser without backdrop-filter shows the near-opaque
         card. The card bg goes slightly translucent so the blur reads. */
      :host([data-card-blur]) .rf-card {
        background: color-mix(in srgb, var(--wz-bg) 82%, transparent);
        backdrop-filter: blur(var(--wz-card-blur));
        -webkit-backdrop-filter: blur(var(--wz-card-blur));
      }
      .rf-logo {
        display: block;
        max-height: 56px;
        max-width: 100%;
        margin-bottom: 12px;
      }
      .rf-cover {
        display: block;
        width: 100%;
        max-height: 180px;
        object-fit: cover;
        border-radius: var(--wz-radius);
        margin-bottom: 16px;
      }
      .rf-title {
        margin: 0 0 4px;
        font-size: calc(var(--wz-font-size) + 6px);
        font-weight: 700;
        color: var(--wz-fg);
      }
      .rf-desc {
        margin: 0 0 16px;
        color: var(--wz-muted);
        font-size: var(--wz-font-size);
      }
      .rf-form {
        display: flex;
        flex-direction: column;
        gap: var(--wz-gap);
        max-width: 100%;
      }
      /* Side-by-side fields: a wrapping row so two consecutive 'half' fields
         sit left+right; a lone half (or a full) takes its own line. The
         honeypot, error, and submit stay in the .rf-form column below. */
      .rf-fields {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wz-gap);
      }
      .rf-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 0 1 100%;
        min-width: 0;
        max-width: 100%;
      }
      .rf-field[data-width='half'] {
        flex-basis: calc(50% - var(--wz-gap) / 2);
      }
      /* On a narrow container halves collapse to full width (matches the
         label-left collapse posture below). */
      @container (max-width: 480px) {
        .rf-field[data-width='half'] {
          flex-basis: 100%;
        }
      }
      /* §2.1 — form-wide multi-column grid. Active only when data-cols is set
         (reflected for '2'/'auto'); the default single column keeps the flex
         row above untouched. Precedence with per-field width: in a grid a
         'full' field spans every column and a 'half' field takes one cell.
         @container min-width breakpoints promote to multiple columns, so a
         narrow embed stays single-column with every field on its own row. */
      :host([data-cols]) .rf-fields {
        display: grid;
        grid-template-columns: 1fr;
        align-items: start;
      }
      :host([data-cols]) .rf-field {
        grid-column: 1 / -1;
      }
      @container (min-width: 34rem) {
        :host([data-cols='2']) .rf-fields {
          grid-template-columns: 1fr 1fr;
        }
        :host([data-cols='auto']) .rf-fields {
          grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        }
        :host([data-cols='2']) .rf-field[data-width='half'],
        :host([data-cols='auto']) .rf-field[data-width='half'] {
          grid-column: auto;
        }
      }
      /* labelPosition:'left' — two-column label/control grid (content blocks
         keep the single-column flow). */
      :host([data-label='left']) .rf-field:not(.rf-block) {
        display: grid;
        grid-template-columns: minmax(100px, 30%) 1fr;
        align-items: center;
        gap: 8px;
      }
      /* Below a narrow width the two-column layout stacks (label above). The
         container is the host itself (container-type: inline-size). */
      @container (max-width: 400px) {
        :host([data-label='left']) .rf-field:not(.rf-block) {
          grid-template-columns: 1fr;
          align-items: stretch;
        }
      }
      .rf-label {
        font-size: calc(var(--wz-font-size) - 1px);
        font-weight: 600;
      }
      .rf-required {
        color: var(--wz-error);
      }
      /* Floating labels (§1.4): gated on the data-float marker (text-like inputs
         only) so other field types keep a top label. :has = order independent. */
      :host([data-label='floating']) .rf-field[data-float] {
        position: relative;
      }
      :host([data-label='floating']) .rf-field[data-float] .rf-label {
        position: absolute;
        top: var(--wz-pad-y);
        left: calc(var(--wz-pad-x) + 2px);
        margin: 0;
        padding: 0 4px;
        font-weight: 400;
        color: var(--wz-muted);
        background: var(--wz-surface);
        pointer-events: none;
        transform-origin: left center;
        transition:
          transform var(--wz-dur) var(--wz-ease),
          color var(--wz-dur) var(--wz-ease);
      }
      :host([data-label='floating'])
        .rf-field[data-float]:has(:is(input, textarea):is(:focus-visible, :not(:placeholder-shown)))
        .rf-label {
        transform: translateY(-1.4em) scale(0.85);
        color: var(--wz-focus);
      }
      /* Content blocks (§1.3): display-only, no label/control. */
      .rf-heading {
        margin: 0;
        font-weight: 700;
        color: var(--wz-fg);
      }
      h2.rf-heading {
        font-size: calc(var(--wz-font-size) + 4px);
      }
      h3.rf-heading {
        font-size: calc(var(--wz-font-size) + 2px);
      }
      .rf-paragraph {
        margin: 0;
        color: var(--wz-muted);
        font-size: var(--wz-font-size);
      }
      .rf-divider {
        width: 100%;
        border: none;
        border-top: 1px solid var(--wz-border);
        margin: 4px 0;
      }
      .rf-block-img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: var(--wz-radius);
      }
      /* Input look (§1.2): one rule block driven by private tokens; only the
         differing tokens flip per variant, so focus/hover/error stay shared.
         Unset tokens (outlined) fall back to today's values. */
      :is(input, select, textarea) {
        font: inherit;
        padding: var(--wz-pad-y) var(--wz-pad-x);
        border: var(--_bw, 1px) solid var(--wz-border);
        border-radius: var(--_r, var(--wz-radius));
        background: var(--_fill, var(--wz-surface));
        color: var(--wz-fg);
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        /* §1.9 — control height scales with inputSize; 'md' (~40px) = today.
           A floor only, so density/§1.6 padding still applies within it and a
           multi-row textarea stays taller. */
        min-height: var(--wz-input-min-h);
        /* §2.4 — eased border/focus transitions. --wz-dur is 0s unless
           animations is on, so this is a no-op today; reduced-motion collapses
           it to ~0. */
        transition:
          border-color var(--wz-dur) var(--wz-ease),
          box-shadow var(--wz-dur) var(--wz-ease),
          background-color var(--wz-dur) var(--wz-ease);
      }
      :host([data-input='filled']) :is(input, select, textarea) {
        --_fill: var(--wz-subtle);
        --_bw: 0;
      }
      :host([data-input='underlined']) :is(input, select, textarea) {
        --_bw: 0;
        --_r: 0;
        --_fill: transparent;
        border-bottom: 2px solid var(--wz-border);
      }
      /* §2.2 — per-field input variant override, scoped to one field wrapper
         (data-input on .rf-field). Self-contained border/radius so it wins
         over both the base rule and the global :host([data-input]) variant for
         that one field; focus/hover/error stay shared via the tokens above. */
      .rf-field[data-input='outlined'] :is(input, select, textarea) {
        --_fill: var(--wz-surface);
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
      }
      .rf-field[data-input='filled'] :is(input, select, textarea) {
        --_fill: var(--wz-subtle);
        border: 0;
        border-radius: var(--wz-radius);
      }
      .rf-field[data-input='underlined'] :is(input, select, textarea) {
        --_fill: transparent;
        border: 0;
        border-radius: 0;
        border-bottom: 2px solid var(--wz-border);
      }
      /* Focus (§1.7): one treatment per data-focus, always WCAG-visible. ring =
         outset outline (base); border/glow drop it on inputs (submit keeps it)
         for an inset ring / halo instead. */
      :is(input, select, textarea):focus-visible,
      .rf-submit:focus-visible {
        outline: var(--wz-focus-width) solid var(--wz-focus);
        outline-offset: 2px;
      }
      :host([data-focus='border']) :is(input, select, textarea):focus-visible {
        outline: none;
        border-color: var(--wz-focus);
        box-shadow: inset 0 0 0 var(--wz-focus-width) var(--wz-focus);
      }
      :host([data-focus='glow']) :is(input, select, textarea):focus-visible {
        outline: none;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--wz-focus) 55%, transparent);
      }
      :is(input, select, textarea):hover {
        border-color: var(--wz-muted);
      }
      /* Real error state: an --wz-error border + soft ring on invalid inputs. */
      :is(input, select, textarea)[aria-invalid='true'] {
        border-color: var(--wz-error);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--wz-error) 22%, transparent);
      }
      .rf-error {
        color: var(--wz-error);
        font-size: calc(var(--wz-font-size) - 2px);
      }
      /* §2.3 — prefix/suffix adornment chips flanking a text-like input.
         Mirrors the +91 phone-prefix chip: standalone bordered chips, so the
         input keeps its own variant/focus/error styling. Absent ⇒ a bare
         input, unchanged. */
      .rf-adorned {
        display: flex;
        gap: 6px;
        align-items: stretch;
      }
      .rf-adorn {
        flex: none;
        display: inline-flex;
        align-items: center;
        padding: var(--wz-pad-y) var(--wz-pad-x);
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        background: var(--wz-subtle);
        color: var(--wz-muted);
        white-space: nowrap;
      }
      /* §2.3 — supporting help text (an aria-describedby target) and the live
         character counter, which shifts to the error color near the limit. */
      .rf-help {
        margin: 0;
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 2px);
      }
      .rf-counter {
        align-self: flex-end;
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 2px);
        font-variant-numeric: tabular-nums;
      }
      .rf-counter[data-near='true'] {
        color: var(--wz-error);
      }
      .rf-phone {
        display: flex;
        gap: 6px;
      }
      .rf-phone-prefix {
        flex: none;
        /* Center "+91" on both axes. The prefix stretches to the input's
           min-height via the flex row, but as a <span> it wouldn't center its
           own text — without this the label sits at the top of the box. Flex
           centering is height- and radius-independent, so it holds whether the
           box renders as a rectangle (small radius) or a circle (pill radius). */
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--wz-pad-y) var(--wz-pad-x);
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        background: var(--wz-subtle);
      }
      .rf-checks {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rf-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: var(--wz-font-size);
      }
      .rf-check input {
        width: auto;
      }
      /* §1.9 — the input min-height governs text inputs, selects, and
         textareas only; toggles (checkbox/radio), the rating stars, and the
         file control opt out so their intrinsic sizing is unchanged. */
      .rf-check input,
      .rf-star input,
      input[type='file'] {
        min-height: 0;
      }
      /* Honeypot: visually hidden but focusable-by-bots. */
      .rf-hp {
        position: absolute !important;
        left: -9999px !important;
        width: 1px;
        height: 1px;
        overflow: hidden;
      }
      .rf-submit {
        font: inherit;
        font-size: var(--wz-btn-font);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: var(--wz-btn-pad-y) calc(var(--wz-pad-x) + 8px);
        border: none;
        border-radius: var(--wz-btn-radius);
        background: var(--wz-primary);
        color: var(--wz-btn-text);
        cursor: pointer;
        align-self: var(--wz-btn-align);
        transition: background-color var(--wz-dur) var(--wz-ease);
      }
      .rf-btn-icon {
        width: 1em;
        height: 1em;
        flex: none;
      }
      .rf-submit:hover {
        background: var(--wz-primary-hover);
      }
      .rf-submit:active {
        background: var(--wz-primary-hover);
        transform: translateY(1px);
      }
      .rf-submit[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
      }
      /* Rating: an accessible radio group styled as star/heart glyphs. */
      .rf-rating {
        display: flex;
        gap: 4px;
      }
      .rf-star {
        position: relative;
        cursor: pointer;
        font-size: calc(var(--wz-font-size) + 8px);
        line-height: 1;
        color: var(--wz-border);
      }
      .rf-star[data-on='true'] {
        color: var(--wz-primary);
      }
      .rf-star:focus-within {
        outline: 2px solid var(--wz-focus);
        outline-offset: 2px;
      }
      .rf-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .rf-star input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
      }
      .rf-status {
        padding: 12px;
        border-radius: var(--wz-radius);
        background: var(--wz-subtle);
        color: var(--wz-muted);
        font-size: var(--wz-font-size);
      }
      .rf-success {
        background: color-mix(in srgb, var(--wz-primary) 12%, var(--wz-bg));
        color: var(--wz-fg);
        border: 1px solid color-mix(in srgb, var(--wz-primary) 35%, transparent);
      }
      .rf-form-error {
        color: var(--wz-error);
        font-size: calc(var(--wz-font-size) - 1px);
      }
      /* Reduced motion (§1.7): collapse the duration token to ~0 rather than
         killing transitions outright, so transitionend still fires (floating
         label). Animations are disabled defensively. */
      @media (prefers-reduced-motion: reduce) {
        :host {
          --wz-dur: 0.01ms;
        }
        *,
        *::before,
        *::after {
          animation: none !important;
        }
      }
    `,
  ];

  @property({ attribute: 'form-id' }) formId = '';
  /** Injectable for tests; defaults to a client built from the SDK prelude config. */
  @property({ attribute: false }) client: FormsClient | null = null;

  // Inline PREVIEW MODE. When `previewSchema` is set the renderer drives itself
  // from these props instead of fetching by form id, and real submission is
  // disabled. This lets the admin embed the REAL renderer (no dual-renderer
  // drift). All other props stay inert while preview is active.
  /** Fields to render inline; a non-null value switches preview mode on. */
  @property({ attribute: false }) previewSchema: FormField[] | null = null;
  @property({ attribute: false }) previewAppearance: FormAppearance | undefined;
  @property({ attribute: false }) previewName = '';
  @property({ attribute: false }) previewDescription = '';
  /** Submit button label in preview; falls back to the default when unset. */
  @property({ attribute: false }) previewSubmitLabel = '';
  /** Success/ending message in preview; falls back to the default when unset. */
  @property({ attribute: false }) previewSuccessMessage = '';
  /** Which screen to show in preview: fillable form, ending, error, or closed. */
  @property({ attribute: false }) previewState: PreviewState = 'ready';

  @state() private schema: PublicFormSchema | null = null;
  @state() private appearance: FormAppearance | undefined;
  @state() private status: Status = 'loading';
  @state() private values: Record<string, unknown> = {};
  @state() private fieldErrors: Record<string, string> = {};
  @state() private formError = '';
  @state() private hp = '';

  private files: Record<string, File | null> = {};
  private recaptchaInjected = false;

  override connectedCallback(): void {
    super.connectedCallback();
    // Preview mode drives itself from inline props (synced in willUpdate); the
    // network fetch path runs only for a real, id-driven embed.
    if (!this.isPreview) void this.loadSchema();
  }

  /** Preview mode is active whenever inline fields have been supplied. */
  private get isPreview(): boolean {
    return this.previewSchema !== null;
  }

  private static readonly PREVIEW_PROPS = [
    'previewSchema',
    'previewAppearance',
    'previewName',
    'previewDescription',
    'previewSubmitLabel',
    'previewSuccessMessage',
    'previewState',
  ] as const;

  /**
   * Keep the internal schema/appearance/status in sync with the inline preview
   * props so the admin can edit the form and see the real renderer update. Runs
   * before render, including the first cycle, so the fetch path is never hit.
   */
  override willUpdate(changed: PropertyValues): void {
    if (!this.isPreview) return;
    if (changed.size > 0 && !RatioForm.PREVIEW_PROPS.some((p) => changed.has(p))) return;
    this.schema = {
      id: 'preview',
      name: this.previewName,
      ...(this.previewDescription ? { description: this.previewDescription } : {}),
      schema: this.previewSchema ?? [],
      submitLabel: this.previewSubmitLabel || 'Submit',
      successMessage: this.previewSuccessMessage || 'Thank you!',
      spamProtection: 'honeypot',
      ...(this.previewAppearance ? { appearance: this.previewAppearance } : {}),
    };
    this.appearance = this.previewAppearance;
    // previewState is a subset of Status, so it maps straight through.
    this.status = this.previewState;
    // Web fonts still resolve only at document scope, even in preview.
    this.maybeInjectFont();
  }

  private resolveClient(): FormsClient | null {
    if (this.client) return this.client;
    const cfg = window.__FORMS_SDK_CONFIG__;
    if (!cfg?.apiBase) return null;
    this.client = new FormsClient({ apiBase: cfg.apiBase });
    return this.client;
  }

  private async loadSchema(): Promise<void> {
    const client = this.resolveClient();
    if (!client || !this.formId) {
      this.status = 'error';
      return;
    }
    try {
      this.schema = await client.getFormSchema(this.formId);
      this.appearance = this.schema.appearance;
      this.status = 'ready';
      this.captureHiddenValues();
      this.maybeInjectFont();
      this.maybeInjectRecaptcha();
    } catch (err) {
      if (err instanceof FormsClientError && err.isFormClosed) {
        this.status = 'closed';
      } else if (err instanceof FormsClientError && err.isFormUnavailable) {
        this.status = 'unavailable';
      } else {
        this.status = 'error';
      }
    }
  }

  /** Lazy: the reCAPTCHA script is injected ONLY when this form needs it. */
  private maybeInjectRecaptcha(): void {
    if (this.recaptchaInjected) return;
    const schema = this.schema;
    if (!schema || schema.spamProtection !== 'recaptcha' || !schema.recaptchaSiteKey) return;
    this.recaptchaInjected = true;
    if (window.grecaptcha) return;
    const marker = 'data-ratio-forms-recaptcha';
    if (document.querySelector(`script[${marker}]`)) return;
    const tag = document.createElement('script');
    tag.setAttribute(marker, '');
    tag.async = true;
    tag.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(schema.recaptchaSiteKey)}`;
    document.head.appendChild(tag);
  }

  /** Seed hidden fields from the page URL (UTM capture etc); no visible DOM. */
  private captureHiddenValues(): void {
    const fields = this.schema?.schema ?? [];
    if (!fields.some((f) => f.type === 'hidden')) return;
    const params = new URLSearchParams(window.location.search);
    const next = { ...this.values };
    for (const field of fields) {
      if (field.type !== 'hidden') continue;
      const value = params.get(field.paramName);
      if (value !== null) next[field.key] = value;
    }
    this.values = next;
  }

  /**
   * Web fonts inside a shadow root only resolve when loaded at document scope,
   * so inject one guarded `<link>` per family into `document.head`. A set
   * customGoogleFont wins over the preset family; its href is SDK-built from a
   * re-sanitized name (never a merchant URL), and the preset path still uses
   * the fixed enum-keyed map — the merchant never supplies a URL either way.
   */
  private maybeInjectFont(): void {
    const typography = this.appearance?.typography;
    const custom = sanitizeFontName(typography?.customGoogleFont);
    if (custom) {
      // id must be whitespace-free (HTML5), so slug the spaces out.
      this.injectFontLink(`ratio-font-custom-${custom.replace(/ /g, '-')}`, customGoogleFontHref(custom));
      return;
    }
    const family = typography?.fontFamily;
    if (!family || family === 'system') return;
    this.injectFontLink(`ratio-font-${family}`, GOOGLE_FONT_HREF[family]);
  }

  /** Inject a single deduped stylesheet `<link>` at document scope. */
  private injectFontLink(id: string, href: string | null): void {
    if (!href) return;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  /** After a successful submit, follow the form's redirectUrl (if any). */
  private maybeRedirect(): void {
    const url = this.schema?.redirectUrl;
    if (!url) return;
    setTimeout(() => {
      window.location.assign(url);
    }, REDIRECT_DELAY_MS);
  }

  private async recaptchaToken(): Promise<string | undefined> {
    const schema = this.schema;
    if (!schema || schema.spamProtection !== 'recaptcha' || !schema.recaptchaSiteKey) {
      return undefined;
    }
    const grecaptcha = window.grecaptcha;
    if (!grecaptcha) return undefined; // script blocked/offline: backend falls back to honeypot
    await new Promise<void>((resolve) => grecaptcha.ready(resolve));
    return grecaptcha.execute(schema.recaptchaSiteKey, { action: 'submit' });
  }

  private validateAll(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of this.schema?.schema ?? []) {
      const error = this.validateField(field);
      if (error) errors[field.key] = error;
    }
    return errors;
  }

  private isEmpty(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  }

  private validateField(field: FormField): string | null {
    // Content blocks (§1.3) collect no value — never validated.
    if (isContentBlock(field)) return null;
    // Dispatch to the per-field client validator (Phase 0 registry). Each
    // module owns its own empty/required gate plus its value checks; the cast
    // widens the per-member validator to the control-field union for dispatch.
    const ctx: FieldValidateCtx = { values: this.values, files: this.files };
    const mod = fieldControls[field.type] as FieldControlModule<ControlField['type']>;
    const error = mod.validate(field, ctx);
    // Merchant-authored custom message (§ production validation): when set it
    // replaces the humanized default for ANY failure on this field. The backend
    // applies the identical override, so client and server return the same
    // string. Content blocks were already ruled out above (they carry no
    // errorMessage); every control field carries the optional baseFieldShape.
    if (error && field.errorMessage) return field.errorMessage;
    return error;
  }

  private async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    // Preview: run validation so the error rings are viewable, but never POST.
    if (this.isPreview) {
      this.fieldErrors = this.validateAll();
      return;
    }
    // Submit-once: ignore anything after the first click until it resolves.
    if (this.status === 'submitting' || this.status === 'success') return;
    const client = this.resolveClient();
    const schema = this.schema;
    if (!client || !schema) return;

    const errors = this.validateAll();
    this.fieldErrors = errors;
    this.formError = '';
    if (Object.keys(errors).length > 0) return;

    this.status = 'submitting';
    try {
      // File flow: presign → PUT bytes → attach object keys.
      const fileKeys: Record<string, string> = {};
      for (const field of schema.schema) {
        if (field.type !== 'file') continue;
        const file = this.files[field.key];
        if (!file) continue;
        const target = await client.requestUpload(this.formId, {
          fieldKey: field.key,
          contentType: file.type,
          size: file.size,
        });
        await client.uploadFile(target, file);
        fileKeys[field.key] = target.objectKey;
      }

      const recaptchaToken = await this.recaptchaToken();
      const fields: Record<string, unknown> = {};
      for (const field of schema.schema) {
        // Files ride separately; content blocks (§1.3) submit no value.
        if (field.type === 'file' || isContentBlock(field)) continue;
        const value = this.values[field.key];
        if (!this.isEmpty(value)) fields[field.key] = value;
      }

      await client.submit(this.formId, {
        fields,
        ...(Object.keys(fileKeys).length > 0 ? { files: fileKeys } : {}),
        sessionId: getAnonId(),
        ...(recaptchaToken ? { recaptchaToken } : {}),
        _hp: this.hp,
      });
      this.status = 'success';
      this.maybeRedirect();
    } catch (err) {
      if (err instanceof FormsClientError) {
        if (err.isDuplicate) {
          // Same submission within the dedup window — treat as delivered.
          this.status = 'success';
          this.maybeRedirect();
          return;
        }
        if (err.isValidationError && err.fieldErrors) {
          this.fieldErrors = err.fieldErrors;
          this.formError = 'Please fix the highlighted fields.';
        } else if (err.isRateLimited) {
          this.formError = 'Too many submissions. Please try again in a few minutes.';
        } else if (err.isFormClosed) {
          this.status = 'closed';
          return;
        } else if (err.isFormUnavailable) {
          this.status = 'unavailable';
          return;
        } else {
          this.formError = 'Something went wrong. Please try again.';
        }
      } else {
        this.formError = 'Something went wrong. Please try again.';
      }
      this.status = 'ready';
    }
  }

  /**
   * Reflect appearance variants to the host as `data-*` attributes so the
   * scoped `:host([data-*])` CSS applies. Each "today" default (top label,
   * outlined input, ring focus) reflects nothing, so an un-themed form is
   * unchanged.
   */
  override updated(): void {
    const l = this.appearance?.layout;
    this.reflectAttr(
      'data-label',
      l?.labelPosition && l.labelPosition !== 'top' ? l.labelPosition : null,
    );
    this.reflectAttr(
      'data-input',
      l?.inputVariant && l.inputVariant !== 'outlined' ? l.inputVariant : null,
    );
    this.reflectAttr('data-focus', l?.focusStyle && l.focusStyle !== 'ring' ? l.focusStyle : null);
    // §2.1 — form-wide column count; '1' (today) reflects nothing.
    this.reflectAttr('data-cols', l?.columns && l.columns !== '1' ? l.columns : null);
    // §2.6 — frosted card only over an image backdrop with a blur radius.
    this.reflectAttr('data-card-blur', this.cardBlurActive ? 'on' : null);
  }

  private reflectAttr(name: string, value: string | null): void {
    if (value) this.setAttribute(name, value);
    else this.removeAttribute(name);
  }

  /** §2.6 — the frosted card applies ONLY over an image backdrop with a blur
   * radius set; otherwise the always-opaque card stays as today. */
  private get cardBlurActive(): boolean {
    const bg = this.appearance?.background;
    return (
      !!bg &&
      bg.type === 'image' &&
      typeof bg.imageUrl === 'string' &&
      bg.imageUrl.startsWith('https://') &&
      (bg.cardBlur ?? 0) > 0
    );
  }

  /** Floating labels (§1.4) apply ONLY to single text-like inputs that render a
   * placeholder. Every other field type (select, phone, checkbox, radio,
   * rating, file, date) keeps a normal top label even under
   * labelPosition:'floating', so no label floats over a chip/control. Derived
   * from the shared adornment matrix (§2.3) so the set stays in lock-step. */
  private static readonly FLOATING_TYPES = new Set<FormField['type']>([
    ...FORM_ADORNABLE_FIELD_TYPES,
    ...FORM_COUNTER_FIELD_TYPES,
  ]);

  private get isFloating(): boolean {
    return this.appearance?.layout?.labelPosition === 'floating';
  }

  /** True when this field's label should float (text-like type + floating).
   * A prefix chip occupies the input's left edge, exactly where a floating
   * label sits, so a prefixed field falls back to a top label (§1.4 + §2.3). */
  private floats(field: FormField): boolean {
    if (!this.isFloating || !RatioForm.FLOATING_TYPES.has(field.type)) return false;
    return !('prefix' in field && field.prefix);
  }

  /** Floating fields drive the placeholder to a space so the CSS
   * `:placeholder-shown` "filled" test works and no duplicate text shows;
   * non-floating fields keep their real placeholder. */
  private ph(field: FormField, fallback: string): string {
    return this.floats(field) ? ' ' : fallback;
  }

  override render(): TemplateResult {
    // Per-instance token overrides. Custom properties pierce the shadow
    // boundary and layer on top of baseStyles' defaults. The wrapping element
    // is required: a binding directly after a raw-text `</style>` is mis-parsed.
    return html`<style>
        ${unsafeCSS(themeVars(this.appearance))}
      </style>
      <div class="rf-root">
        <div class="rf-card">${this.renderHeader()}${this.renderState()}</div>
      </div>`;
  }

  /**
   * Optional logo, cover, title, and description above the fields. Wrapped in a
   * static-first element: a nested template that *starts* with a binding drops
   * the following binding under Lit's happy-dom parse.
   */
  private renderHeader(): TemplateResult | typeof nothing {
    const schema = this.schema;
    if (!schema) return nothing;
    const logo = this.appearance?.logo?.url;
    const cover = this.appearance?.cover?.url;
    return html`<div class="rf-head">
      ${logo ? html`<img class="rf-logo" src=${logo} alt="" />` : nothing}
      ${cover ? html`<img class="rf-cover" src=${cover} alt="" />` : nothing}
      <h2 class="rf-title">${schema.name}</h2>
      ${schema.description ? html`<p class="rf-desc">${schema.description}</p>` : nothing}
    </div>`;
  }

  private renderState(): TemplateResult {
    switch (this.status) {
      case 'loading':
        return html`<div class="rf-status" data-state="loading">Loading...</div>`;
      case 'closed':
        return html`<div class="rf-status" data-state="closed">This form is closed.</div>`;
      case 'unavailable':
        return html`<div class="rf-status" data-state="unavailable">
          This form is no longer available.
        </div>`;
      case 'error':
        return html`<div class="rf-status" data-state="error">
          This form could not be loaded.
        </div>`;
      case 'success':
        return html`<div class="rf-status rf-success" data-state="success">
          ${this.schema?.successMessage ?? 'Thank you!'}
        </div>`;
      default:
        return this.renderForm();
    }
  }

  /**
   * Deliberately a `role="form"` div, not a native `<form>`: submit is the
   * button's click handler (+ Enter on any input). Equivalent UX in real
   * browsers — and it sidesteps native constraint validation and happy-dom's
   * proxied HTMLFormElement, which corrupts Lit child-part bindings.
   */
  private renderForm(): TemplateResult {
    const schema = this.schema;
    if (!schema) return html`${nothing}`;
    return html`
      <div class="rf-form" role="form" @keydown=${this.onKeydown}>
        <div class="rf-fields">${schema.schema.map((field) => this.renderField(field))}</div>
        <div class="rf-hp" aria-hidden="true">
          <input
            type="text"
            name="_hp"
            tabindex="-1"
            autocomplete="off"
            .value=${this.hp}
            @input=${(e: Event) => {
              this.hp = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
        <div class="rf-form-error" role="alert">${this.formError}</div>
        <button
          type="button"
          class="rf-submit"
          ?disabled=${this.status === 'submitting'}
          @click=${this.onSubmit}
        >
          ${this.renderButtonIcon()}${
            this.status === 'submitting' ? 'Submitting...' : schema.submitLabel
          }
        </button>
      </div>
    `;
  }

  /** Optional leading glyph on the submit button (§1.5); 'none' = no icon. */
  private renderButtonIcon(): TemplateResult | typeof nothing {
    const icon = this.appearance?.layout?.buttonIcon ?? 'none';
    if (icon === 'none') return nothing;
    return html`<svg class="rf-btn-icon" viewBox="0 0 24 24" aria-hidden="true">
      ${BUTTON_ICONS[icon]}
    </svg>`;
  }

  /** Enter in a single-line input submits, like a native form would. */
  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') {
      event.preventDefault();
      void this.onSubmit(event);
    }
  }

  private renderField(field: FormField): TemplateResult {
    // Hidden fields have no visible DOM; their value rides along on submit.
    if (field.type === 'hidden') return html`${nothing}`;
    // Content blocks (§1.3) render inline with no label/control/error.
    if (isContentBlock(field)) return this.renderBlock(field);
    const error = this.fieldErrors[field.key];
    // data-float marks the text-like fields whose label may float (§1.4); the
    // floating CSS is gated on it, so other types keep a normal top label.
    // data-input / style carry the per-field style override (§2.2); helpText
    // and the counter are the per-field adornments (§2.3).
    const help = field.helpText;
    return html`
      <div
        class="rf-field"
        data-field=${field.key}
        data-width=${field.width ?? 'full'}
        data-input=${field.style?.inputVariant ?? nothing}
        style=${this.fieldAccent(field)}
        ?data-float=${this.floats(field)}
      >
        <label
          class="rf-label"
          id=${`rf-label-${field.key}`}
          for=${GROUP_FIELD_TYPES.has(field.type) ? nothing : `rf-${field.key}`}
        >
          ${field.label}${this.renderRequiredMark(field.required)}
        </label>
        ${this.renderControl(field)}
        ${help ? html`<p class="rf-help" id=${`rf-help-${field.key}`}>${help}</p>` : nothing}
        ${this.renderCounter(field)}
        ${
          error
            ? html`<div class="rf-error" id=${`rf-err-${field.key}`} data-error-for=${field.key}>
                ${error}
              </div>`
            : nothing
        }
      </div>
    `;
  }

  /**
   * §2.2 — per-field accent as a scoped inline custom-property override. The
   * hex is re-checked defensively (the schema already guarantees it) so only a
   * clean color reaches the inline style; it recolors this field's focus ring
   * and control accent, and falls back to the global primary when unset.
   */
  private fieldAccent(field: Exclude<FormField, ContentBlockField>): string | typeof nothing {
    const accent = field.style?.accent;
    if (!accent || !HEX_COLOR_RE.test(accent)) return nothing;
    return `--wz-focus:${accent};--wz-primary:${accent}`;
  }

  /**
   * §2.3 — live character counter (used/limit) for text/textarea fields with
   * showCounter and a maxLength; shifts to the error color near the limit.
   * Decorative (aria-hidden) so it never doubles the field's semantics.
   */
  private renderCounter(
    field: Exclude<FormField, ContentBlockField>,
  ): TemplateResult | typeof nothing {
    if (!field.showCounter) return nothing;
    if (!supportsCounter(field.type)) return nothing;
    // supportsCounter admits only text/textarea, whose validation carries the
    // maxLength the counter reads; this narrows the union to that pair.
    const counted = field as Extract<FormField, { type: 'text' | 'textarea' }>;
    const max = counted.validation?.maxLength;
    if (typeof max !== 'number') return nothing;
    const len = String(this.values[field.key] ?? '').length;
    return html`<div
      class="rf-counter"
      data-near=${len >= max * 0.9 ? 'true' : nothing}
      aria-hidden="true"
    >
      ${len}/${max}
    </div>`;
  }

  /**
   * §2.3 — flank a text-like input with static prefix/suffix chips (text nodes
   * only). Mirrors the +91 phone-prefix chip, so the input keeps its own
   * variant/focus/error styling. No adornments ⇒ the bare input, unchanged.
   */
  private adorn(
    field: Exclude<FormField, ContentBlockField>,
    control: TemplateResult,
  ): TemplateResult {
    // Chips flank only the adornable text-like types (§2.3); everything else
    // (textarea, phone, ...) keeps the bare control the admin never offers.
    if (!isAdornable(field.type) || (!field.prefix && !field.suffix)) return control;
    return html`<div class="rf-adorned">
      ${field.prefix ? html`<span class="rf-adorn rf-adorn-prefix">${field.prefix}</span>` : nothing}
      ${control}
      ${field.suffix ? html`<span class="rf-adorn rf-adorn-suffix">${field.suffix}</span>` : nothing}
    </div>`;
  }

  /** Required-indicator style (§1.8): asterisk (today), the word, or nothing. */
  private renderRequiredMark(required: boolean): TemplateResult | typeof nothing {
    if (!required) return nothing;
    const mark = this.appearance?.layout?.requiredMark ?? 'asterisk';
    if (mark === 'none') return nothing;
    return html`<span class="rf-required"> ${mark === 'text' ? 'Required' : '*'}</span>`;
  }

  /** Render a content block (§1.3): heading, divider, paragraph, or image. */
  private renderBlock(field: ContentBlockField): TemplateResult {
    let inner: TemplateResult;
    switch (field.type) {
      case 'heading':
        // textContent binding — never innerHTML.
        inner =
          field.level === 'h3'
            ? html`<h3 class="rf-heading">${field.text}</h3>`
            : html`<h2 class="rf-heading">${field.text}</h2>`;
        break;
      case 'divider':
        inner = html`<hr class="rf-divider" />`;
        break;
      case 'paragraph':
        inner = html`<p class="rf-paragraph">${field.text}</p>`;
        break;
      case 'image':
        // src via the audited https asset flow (validated in the schema),
        // loading=lazy, capped width.
        inner = html`<img
          class="rf-block-img"
          src=${field.url}
          alt=${field.alt ?? ''}
          loading="lazy"
        />`;
        break;
    }
    return html`<div class="rf-field rf-block" data-field=${field.key} data-width=${field.width ?? 'full'}>
      ${inner}
    </div>`;
  }

  private setValue(key: string, value: unknown): void {
    this.values = { ...this.values, [key]: value };
  }

  private renderControl(field: ControlField): TemplateResult {
    const id = `rf-${field.key}`;
    // Wire the error state to assistive tech (aria-invalid + a pointer to the
    // error text) so the visual --wz-error ring has a semantic counterpart.
    const invalid = this.fieldErrors[field.key] ? 'true' : nothing;
    // aria-describedby points at the help text (§2.3) and/or the error text, in
    // that reading order; nothing when neither is present.
    const describedByIds: string[] = [];
    if (field.helpText) describedByIds.push(`rf-help-${field.key}`);
    if (this.fieldErrors[field.key]) describedByIds.push(`rf-err-${field.key}`);
    const describedBy = describedByIds.length > 0 ? describedByIds.join(' ') : nothing;
    const onInput = (e: Event) =>
      this.setValue(field.key, (e.target as HTMLInputElement | HTMLTextAreaElement).value);

    // Dispatch to the per-field render module (Phase 0 registry). The ctx
    // carries the per-field locals + bound helpers each control needs; the cast
    // widens the per-member render fn to the control-field union for dispatch.
    const ctx: FieldRenderCtx = {
      id,
      invalid,
      describedBy,
      values: this.values,
      files: this.files,
      onInput,
      setValue: (key, value) => this.setValue(key, value),
      ph: (f, fallback) => this.ph(f, fallback),
      adorn: (f, control) => this.adorn(f, control),
      requestUpdate: () => this.requestUpdate(),
    };
    const mod = fieldControls[field.type] as FieldControlModule<ControlField['type']>;
    return mod.render(field, ctx);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ratio-form': RatioForm;
  }
}
