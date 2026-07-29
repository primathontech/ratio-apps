// Type-only shapes of the shared form-schema contract (no Zod in the bundle).
import type { FormAppearance, FormEndingIcon, FormField } from '@ratio-app/shared';
import { resolveHiddenValue } from '@ratio-app/shared/schemas/fields/hidden/constants';
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
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { getAnonId } from '../anon-id';
import { FormsClient, FormsClientError, type PublicFormSchema } from '../client';
// Per-field module registry (Phase 0 refactor): renderControl + validateField
// dispatch through this map. Zod-free (only lit + type-only shared imports).
import { todayISO } from './fields/date/render';
import { fieldControls } from './fields/registry';
import type {
  ContentBlockField,
  ControlField,
  FieldControlModule,
  FieldRenderCtx,
  FieldValidateCtx,
  SelectUiState,
} from './fields/types';
import {
  baseStyles,
  customGoogleFontHref,
  GOOGLE_FONT_HREF,
  sanitizeFontName,
  themeVars,
} from './theme';

/** Defensive hex re-check for the per-field accent (§2.2); the schema already
 * guarantees hex, so this only confines what reaches the inline style. */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Defensive https re-check for the image block's linkUrl (§4.15); the schema
 * already guarantees https, so this only confines what reaches an <a href>. */
const HTTPS_URL_RE = /^https:\/\//i;
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
    field.type === 'image' ||
    field.type === 'html'
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

// Batch 6 — curated end-panel glyphs keyed by the shared FORM_ENDING_ICONS enum
// (same static-markup-only pattern as BUTTON_ICONS). Rendered at 44×44 via
// renderEndingIcon; 'currentColor' so each panel's accent tokens tint it. The
// 'check' path matches today's success glyph exactly.
const ENDING_ICONS: Record<Exclude<FormEndingIcon, 'none'>, TemplateResult> = {
  check: svg`<circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"></circle><path d="M7 12.4l3.3 3.3L17 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`,
  info: svg`<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M12 11v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="12" cy="7.6" r="0.9" fill="currentColor"></circle>`,
  warning: svg`<path d="M12 3.5l9 15.5H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path><path d="M12 10v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="12" cy="16.6" r="0.9" fill="currentColor"></circle>`,
  lock: svg`<rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>`,
  clock: svg`<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"></circle><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>`,
};

// Default glyph per end state when the merchant authors copy but no icon. Mirrors
// the shared FORM_ENDING_STATES set; 'success' keeps today's check.
const DEFAULT_ENDING_ICON: Record<
  'success' | 'closed' | 'expired' | 'unavailable' | 'error',
  FormEndingIcon
> = {
  success: 'check',
  closed: 'lock',
  expired: 'clock',
  unavailable: 'info',
  error: 'warning',
};

// Default body copy per non-success end state — the exact strings today's
// status screens show, reused when a merchant authors a panel (an icon/heading)
// but leaves the body blank, so the fallback text is never lost.
const DEFAULT_ENDING_BODY: Record<'closed' | 'expired' | 'unavailable' | 'error', string> = {
  closed: 'This form is closed.',
  expired: 'This form is no longer available.',
  unavailable: 'This form is no longer available.',
  error: 'This form could not be loaded.',
};

// Hardcoded "Powered by" footer target (branding.showPoweredBy). Single named
// constant so the link is trivial to retarget; no merchant value reaches it.
const POWERED_BY_URL = 'https://ratio.so';

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
        /* Own stacking context so the bg/scrim/card z-index ladder is scoped. */
        isolation: isolate;
        background-color: var(--wz-page-bg);
        /* §3 — backdrop breathes above/below the card; 0 when transparent. */
        padding-block: var(--wz-page-pad);
      }
      /* §1.6 — dedicated image layer so brightness/blur/grayscale filters never
         touch the card or content (distinct from §2.6 card backdrop-filter).
         Sits below the scrim and the card. */
      .rf-bg {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image: var(--wz-page-bg-image);
        background-size: var(--wz-page-bg-size);
        background-repeat: var(--wz-page-bg-repeat);
        background-position: center;
        filter: var(--wz-bg-filter);
        pointer-events: none;
      }
      .rf-root::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        background: var(--wz-page-scrim);
        pointer-events: none;
      }
      /* The professional default: a centered card carrying the theme surface,
         border, and shadow. Logo/cover/heading sit above the fields. Positioned
         so it stacks above the page scrim. */
      .rf-card {
        position: relative;
        z-index: 2;
        background: var(--wz-bg);
        color: var(--wz-fg);
        /* §1.2 — body font + line-height roles (default to --wz-font / normal),
           so headings can override with their own role tokens. */
        font-family: var(--wz-font-body);
        line-height: var(--wz-lh-body);
        padding: var(--wz-card-pad);
        border: var(--wz-card-border);
        border-radius: var(--wz-radius);
        box-shadow: var(--wz-card-shadow);
        max-width: var(--wz-max-width);
        margin: 0 auto;
        box-sizing: border-box;
      }
      /* §1.3 — flat surface: drop the card border/shadow/fill so the form sits
         directly on the page. 'card' (default) reflects nothing. */
      :host([data-layout='flat']) .rf-card {
        background: transparent;
        border: none;
        box-shadow: none;
      }
      /* §1.3 — center the header block, logo, and heading blocks; 'left'
         (default) reflects nothing. */
      :host([data-align='center']) .rf-head {
        text-align: center;
      }
      :host([data-align='center']) .rf-logo {
        margin-left: auto;
        margin-right: auto;
      }
      :host([data-align='center']) .rf-heading {
        text-align: center;
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
        /* Batch 6 — logo height cap from the enum→px token; 56px = today. The
           per-logo alignment rides an inline margin style (SDK-composed from the
           align enum) so it wins over the contentAlign host-centering rule. */
        max-height: var(--wz-logo-max-h, 56px);
        max-width: 100%;
        margin-bottom: 12px;
      }
      /* Batch 6 — cover wrapper hosts the dark overlay layer and clips the
         image (and its optional blur) to the card radius. With overlay 0, blur
         0, and height 180 the wrapper renders visually identical to today. */
      .rf-cover-wrap {
        position: relative;
        margin-bottom: 16px;
        border-radius: var(--wz-radius);
        overflow: hidden;
      }
      .rf-cover-wrap::after {
        content: '';
        position: absolute;
        inset: 0;
        /* rgba(0,0,0,0) (default) is fully transparent ⇒ no overlay today. */
        background: var(--wz-cover-overlay, rgba(0, 0, 0, 0));
        pointer-events: none;
      }
      .rf-cover {
        display: block;
        width: 100%;
        max-height: var(--wz-cover-max-h, 180px);
        object-fit: cover;
        /* Blur filter (0 ⇒ none by default). Radius lives on the wrapper. */
        filter: var(--wz-cover-filter, none);
      }
      .rf-title {
        margin: 0 0 4px;
        /* §1.2 — role-scoped size / heading font / heading line-height. Defaults
           reproduce today (base+6, --wz-font, normal). */
        font-size: var(--wz-fs-title);
        font-family: var(--wz-font-heading);
        line-height: var(--wz-lh-heading);
        font-weight: 700;
        color: var(--wz-fg);
        /* A long unbroken name/URL must break rather than force page scroll. */
        overflow-wrap: break-word;
      }
      .rf-desc {
        margin: 0 0 16px;
        color: var(--wz-muted);
        font-size: var(--wz-font-size);
        overflow-wrap: break-word;
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
        gap: 0.3em;
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
        /* Long unbroken labels wrap inside the field instead of overflowing.
           min-width:0 lets the label shrink as a grid/flex child (label-left). */
        overflow-wrap: break-word;
        min-width: 0;
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
      /* Content blocks (§1.3, §4.15): display-only, no label/control. */
      /* §4.15 — small uppercase kicker above the heading. */
      .rf-eyebrow {
        display: block;
        margin: 0 0 2px;
        font-size: calc(var(--wz-font-size) - 3px);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--wz-muted);
      }
      .rf-heading {
        margin: 0;
        /* §1.2 — heading font + line-height roles (default to --wz-font / normal). */
        font-family: var(--wz-font-heading);
        line-height: var(--wz-lh-heading);
        font-weight: 700;
        color: var(--wz-fg);
      }
      /* §4.15 — visual size decoupled from the h2/h3 tag; 'md' = the prior h2 size. */
      .rf-heading[data-size='sm'] {
        font-size: calc(var(--wz-font-size) + 2px);
      }
      .rf-heading[data-size='md'] {
        font-size: calc(var(--wz-font-size) + 4px);
      }
      .rf-heading[data-size='lg'] {
        font-size: calc(var(--wz-font-size) + 8px);
      }
      .rf-paragraph {
        margin: 0;
        color: var(--wz-muted);
        font-size: var(--wz-font-size);
        overflow-wrap: break-word;
      }
      /* §4.15 — alignment inherits from the wrapper into heading/paragraph text. */
      .rf-block[data-align='center'] {
        text-align: center;
      }
      .rf-block[data-align='right'] {
        text-align: right;
      }
      .rf-divider {
        width: 100%;
        border: none;
        border-top: 1px solid var(--wz-border);
        margin: 4px 0;
      }
      /* §4.15 — variant flips only the border-style; 'spacer' drops the rule. */
      .rf-divider[data-variant='dashed'] {
        border-top-style: dashed;
      }
      .rf-divider[data-variant='dotted'] {
        border-top-style: dotted;
      }
      .rf-divider[data-variant='spacer'] {
        border-top: none;
      }
      /* §4.15 — figure caps width (size) and aligns itself via auto margins. */
      .rf-figure {
        margin: 0;
        max-width: 100%;
      }
      .rf-figure[data-size='sm'] {
        max-width: 240px;
      }
      .rf-figure[data-size='md'] {
        max-width: 480px;
      }
      .rf-figure[data-size='lg'] {
        max-width: 720px;
      }
      .rf-figure[data-align='center'] {
        margin-left: auto;
        margin-right: auto;
      }
      .rf-figure[data-align='right'] {
        margin-left: auto;
      }
      .rf-block-link {
        display: block;
      }
      .rf-block-img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: var(--wz-radius);
      }
      /* §4.15 — caption under the image; follows the figure's alignment. */
      .rf-figcaption {
        margin-top: 6px;
        font-size: calc(var(--wz-font-size) - 2px);
        color: var(--wz-muted);
      }
      .rf-figure[data-align='center'] .rf-figcaption {
        text-align: center;
      }
      .rf-figure[data-align='right'] .rf-figcaption {
        text-align: right;
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
        /* Let inputs shrink inside flex rows (.rf-phone, .rf-adorned) instead of flooring at min-content and overflowing a narrow card. */
        min-width: 0;
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
      /* §1 — placeholder color (defaults to muted) at full opacity so it renders
         consistently across browsers. */
      ::placeholder {
        color: var(--wz-placeholder);
        opacity: 1;
      }
      /* §1 — link color + underline (non-color cue); inert until a form renders
         an anchor, but the token stays wired. */
      a {
        color: var(--wz-link);
        text-decoration: underline;
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
        outline-offset: var(--wz-focus-offset);
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
      /* Disabled control (e.g. multi-file picker at its limit): dim + inert cue. */
      :is(input, select, textarea):disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: var(--wz-subtle);
      }
      /* Real error state: an --wz-error border + soft ring on invalid inputs. */
      :is(input, select, textarea)[aria-invalid='true'] {
        border-color: var(--wz-error);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--wz-error) 22%, transparent);
      }
      /* Grouped fields (radio/multi_select/rating) carry aria-invalid on the container, not a native control — give the group its own error cue. */
      .rf-checks[aria-invalid='true'],
      .rf-rating[aria-invalid='true'] {
        outline: 1px solid var(--wz-error);
        outline-offset: 4px;
        border-radius: var(--wz-radius);
      }
      /* Autofill (§1.4 I1): Chrome paints its own yellow bg + dark text, which
         breaks the filled/underlined/dark variants. Re-assert the field's own
         surface + fg via the inset box-shadow trick. */
      :is(input, select, textarea):-webkit-autofill,
      :is(input, select, textarea):-webkit-autofill:hover,
      :is(input, select, textarea):-webkit-autofill:focus {
        -webkit-text-fill-color: var(--wz-fg);
        -webkit-box-shadow: 0 0 0 1000px var(--_fill, var(--wz-surface)) inset;
        caret-color: var(--wz-fg);
      }
      /* Windows High Contrast (§ A8): box-shadow rings/glows aren't painted, so
         re-express focus + error with real outlines against system colors. */
      @media (forced-colors: active) {
        :is(input, select, textarea):focus-visible,
        .rf-submit:focus-visible {
          outline: 2px solid CanvasText;
          outline-offset: 2px;
        }
        :is(input, select, textarea)[aria-invalid='true'],
        .rf-checks[aria-invalid='true'],
        .rf-rating[aria-invalid='true'] {
          outline: 2px solid Mark;
        }
      }
      .rf-error {
        color: var(--wz-error);
        font-size: calc(var(--wz-font-size) - 2px);
        overflow-wrap: break-word;
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
        min-width: 0;
        overflow-wrap: break-word;
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
      /* Multi-select selection counter — matches the char-counter's muted helper look. */
      .rf-selcount {
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 2px);
        font-variant-numeric: tabular-nums;
      }
      /* Inline link-buttons: email "Did you mean…" correction + multi-select "Select all / Clear". */
      .rf-email-suggest,
      .rf-linkbtn {
        align-self: flex-start;
        background: none;
        border: none;
        padding: 0;
        margin-top: 4px;
        color: var(--wz-link);
        font-size: calc(var(--wz-font-size) - 1px);
        text-decoration: underline;
        cursor: pointer;
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
      /* Multi-country dial-code select must not stretch to 100% and crowd the number input. */
      .rf-phone-country {
        flex: 0 0 auto;
        width: auto;
        max-width: 40%;
      }
      .rf-checks {
        display: flex;
        flex-direction: column;
        gap: 0.43em;
      }
      .rf-check {
        display: flex;
        align-items: center;
        gap: 0.57em;
        /* Content-proportional row height (relative to the form's font), the
           production pattern for option lists: scales with typography, no fixed
           px. The whole label is the clickable hit area. */
        min-height: 2.25em;
        font-size: var(--wz-font-size);
        /* Long unbroken option text wraps instead of overflowing the card;
           min-width:0 lets the label shrink within its .rf-checks column. */
        overflow-wrap: break-word;
        min-width: 0;
      }
      .rf-check input {
        width: auto;
      }
      /* Chip options (multi_select display:chips) carry inline pill styling from
         the renderer; the widget only adds the wrap guard so a long single-word
         option breaks inside the pill rather than forcing horizontal scroll. */
      .rf-chip {
        overflow-wrap: break-word;
        min-width: 0;
      }
      /* §1.9 — the input min-height governs text inputs, selects, and
         textareas only; toggles (checkbox/radio), the rating stars, and the
         file control opt out so their intrinsic sizing is unchanged. */
      .rf-check input,
      .rf-star input,
      .rf-rating-num input,
      input[type='file'] {
        min-height: 0;
      }
      /* §4.5 — "Other" free-text input, revealed under a select/radio/multi
         when the Other choice is picked. A normal themed text input. */
      .rf-other-input {
        margin-top: 6px;
      }
      /* §4.9 — radio layout. vertical (no data-layout) is the .rf-checks
         column default; horizontal wraps into a row; grid sets its own
         inline grid-template from the bounded gridColumns. */
      .rf-checks[data-layout='horizontal'] {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 12px;
      }
      /* §4.9 — radio visual variants. list (no data-variant) keeps today's
         plain rows. button/card keep the real input for a11y but hide it
         visually and style the label as a segment / bordered card, filled with
         the accent when checked. */
      .rf-checks[data-variant='button'] .rf-check,
      .rf-checks[data-variant='card'] .rf-check {
        position: relative;
        cursor: pointer;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        padding: var(--wz-pad-y) var(--wz-pad-x);
        transition:
          border-color var(--wz-dur) var(--wz-ease),
          background-color var(--wz-dur) var(--wz-ease);
      }
      .rf-checks[data-variant='button'] .rf-check {
        justify-content: center;
      }
      .rf-checks[data-variant='button'] .rf-check input,
      .rf-checks[data-variant='card'] .rf-check input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
        margin: 0;
        pointer-events: none;
      }
      .rf-checks[data-variant='button'] .rf-check:has(input:checked),
      .rf-checks[data-variant='card'] .rf-check:has(input:checked) {
        border-color: var(--wz-primary);
        background: color-mix(in srgb, var(--wz-primary) 12%, transparent);
      }
      .rf-checks[data-variant='button'] .rf-check:has(input:focus-visible),
      .rf-checks[data-variant='card'] .rf-check:has(input:focus-visible) {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--wz-focus) 40%, transparent);
      }
      /* §4.5 — searchable combobox: a text input over a floating listbox. */
      .rf-combo {
        position: relative;
      }
      .rf-combo-list {
        position: absolute;
        z-index: 20;
        left: 0;
        right: 0;
        margin: 4px 0 0;
        padding: 4px;
        list-style: none;
        max-height: 240px;
        overflow-y: auto;
        background: var(--wz-bg, #fff);
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
      }
      .rf-combo-list[hidden] {
        display: none;
      }
      .rf-combo-opt {
        padding: var(--wz-pad-y) var(--wz-pad-x);
        border-radius: var(--wz-radius);
        cursor: pointer;
      }
      .rf-combo-opt[data-active],
      .rf-combo-opt:hover {
        background: color-mix(in srgb, var(--wz-primary) 12%, transparent);
      }
      .rf-combo-opt[aria-selected='true'] {
        font-weight: 600;
      }
      .rf-combo-empty {
        padding: var(--wz-pad-y) var(--wz-pad-x);
        color: var(--wz-muted);
      }
      /* Multi-file field (file.maxFiles > 1): the dropzone input plus a list of
         chosen files, each with an image preview / name / size and a remove
         control. A single-file field renders a bare <input> and none of this. */
      .rf-filefield {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rf-file-hint {
        margin: 0;
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 2px);
        overflow-wrap: break-word;
      }
      /* Transient "only N files allowed / couldn't add" notice — error-toned, no UA margin. */
      .rf-file-notice {
        margin: 0;
        color: var(--wz-error);
        font-size: calc(var(--wz-font-size) - 2px);
        overflow-wrap: break-word;
      }
      .rf-files {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rf-file {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        background: var(--wz-subtle);
      }
      .rf-file-thumb {
        flex: none;
        width: 32px;
        height: 32px;
        object-fit: cover;
        border-radius: calc(var(--wz-radius) / 2);
      }
      .rf-file-thumb-doc {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: var(--wz-muted);
        background: var(--wz-surface);
      }
      .rf-file-meta {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .rf-file-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: calc(var(--wz-font-size) - 1px);
      }
      .rf-file-size {
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 3px);
        font-variant-numeric: tabular-nums;
      }
      .rf-file-remove {
        flex: none;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--wz-muted);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      .rf-file-remove:hover {
        color: var(--wz-error);
        background: color-mix(in srgb, var(--wz-error) 12%, transparent);
      }
      /* Honeypot: visually hidden but focusable-by-bots. */
      .rf-hp {
        position: absolute !important;
        left: -9999px !important;
        width: 1px;
        height: 1px;
        overflow: hidden;
      }
      /* §1.5 — button fill driven by tokens; the solid defaults reproduce today.
         data-btn-variant flips the tokens per variant (no per-variant block for
         the shared box). Border width is a token (0 for solid) so solid keeps
         today's exact height. */
      .rf-submit {
        font: inherit;
        font-size: var(--wz-btn-font);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: var(--wz-btn-pad-y) calc(var(--wz-pad-x) + 8px);
        min-height: 44px;
        border: var(--wz-btn-bw) solid var(--wz-btn-border);
        border-radius: var(--wz-btn-radius);
        background: var(--wz-btn-bg);
        color: var(--wz-btn-fg);
        cursor: pointer;
        align-self: var(--wz-btn-align);
        transition:
          background-color var(--wz-dur) var(--wz-ease),
          border-color var(--wz-dur) var(--wz-ease);
      }
      .rf-submit[data-btn-variant='outline'] {
        --wz-btn-bg: transparent;
        --wz-btn-fg: var(--wz-primary);
        --wz-btn-border: var(--wz-primary);
        --wz-btn-bw: 1px;
        --wz-btn-bg-hover: color-mix(in srgb, var(--wz-primary) 12%, var(--wz-bg));
      }
      .rf-submit[data-btn-variant='ghost'] {
        --wz-btn-bg: transparent;
        --wz-btn-fg: var(--wz-primary);
        --wz-btn-bg-hover: color-mix(in srgb, var(--wz-primary) 12%, var(--wz-bg));
      }
      .rf-submit[data-btn-variant='soft'] {
        --wz-btn-bg: color-mix(in srgb, var(--wz-primary) 14%, var(--wz-bg));
        --wz-btn-fg: var(--wz-primary);
        --wz-btn-bg-hover: color-mix(in srgb, var(--wz-primary) 22%, var(--wz-bg));
      }
      .rf-btn-icon {
        width: 1em;
        height: 1em;
        flex: none;
      }
      /* §1.8 — submit busy spinner; under prefers-reduced-motion the blanket
         animation kill (below) freezes it to a static ring — still a visible
         cue. Colored from the button foreground so every variant reads. */
      .rf-spinner {
        width: 1em;
        height: 1em;
        flex: none;
        border: 2px solid color-mix(in srgb, var(--wz-btn-fg) 35%, transparent);
        border-top-color: var(--wz-btn-fg);
        border-radius: 50%;
        animation: rf-spin 0.6s linear infinite;
      }
      @keyframes rf-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .rf-submit:hover {
        background: var(--wz-btn-bg-hover);
      }
      .rf-submit:active {
        background: var(--wz-btn-bg-hover);
        transform: translateY(1px);
      }
      /* §1.8 a11y — the button stays focusable while submitting (aria-disabled +
         aria-busy, not the DOM disabled attribute that drops focus); re-entry is
         guarded in onSubmit. */
      .rf-submit[aria-disabled='true'] {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .rf-spin {
        width: 1em;
        height: 1em;
        flex: none;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: rf-spin 0.6s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .rf-spin {
          animation-duration: 1.6s;
        }
      }
      @keyframes rf-spin {
        to {
          transform: rotate(360deg);
        }
      }
      /* Rating: an accessible radio group styled as star/heart glyphs. */
      .rf-rating {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .rf-star {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
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
        outline-offset: var(--wz-focus-offset);
      }
      /* multi_select chips carry focus on a 1px-clipped SR-only checkbox, so
         :focus-within surfaces a keyboard focus ring on the visible pill. */
      .rf-chip:focus-within {
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
      /* Numbered rating scale (display:'numbers', e.g. 0–10 NPS): each option a themed chip, selected = filled primary. */
      .rf-rating-num {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 36px;
        min-height: 36px;
        padding: 0 6px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        cursor: pointer;
        font-size: var(--wz-font-size);
        line-height: 1;
        color: var(--wz-fg);
      }
      .rf-rating-num[data-on='true'] {
        background: var(--wz-primary);
        border-color: var(--wz-primary);
        color: var(--wz-btn-fg);
      }
      .rf-rating-num:focus-within {
        outline: 2px solid var(--wz-focus);
        outline-offset: var(--wz-focus-offset);
      }
      .rf-rating-num input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
      }
      /* Low/high end labels sit on their own full-width row, anchored to the two ends of the scale. */
      .rf-rating-labels {
        flex-basis: 100%;
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        font-size: calc(var(--wz-font-size) - 2px);
        color: var(--wz-muted);
      }
      /* A status screen is a self-contained, centred confirmation column — not
         the form layout. */
      .rf-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 28px 24px;
        border-radius: var(--wz-radius);
        background: var(--wz-subtle);
        color: var(--wz-muted);
        font-size: var(--wz-font-size);
        text-align: center;
      }
      .rf-status-icon {
        color: var(--wz-primary);
        flex: 0 0 auto;
      }
      /* A status/ending heading + message wrap long unbroken merchant copy
         instead of overflowing the (centred, capped) confirmation card. */
      .rf-status-heading {
        margin: 0;
        overflow-wrap: break-word;
      }
      .rf-status-msg {
        margin: 0;
        line-height: 1.5;
        overflow-wrap: break-word;
      }
      /* Batch 6 — structured end-panel heading sits above the body copy, in the
         heading font/color; only rendered when the merchant authors one. */
      .rf-status-heading {
        margin: 0;
        font-family: var(--wz-font-heading);
        font-weight: 700;
        font-size: var(--wz-fs-h3);
        color: var(--wz-fg);
      }
      /* Batch 6 — the redirect countdown line under the success message. */
      .rf-countdown {
        margin: 0;
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 1px);
      }
      /* §1 — success panel driven by the success tokens (default to the primary
         mix, so today's look is unchanged; recolors when colors.success is set). */
      .rf-success {
        background: var(--wz-success-bg);
        color: var(--wz-success-on);
        border: 1px solid var(--wz-success-border);
      }
      .rf-success .rf-status-icon {
        color: var(--wz-success);
      }
      /* A status screen shrinks the card to a comfortable confirmation width
         (never wider than the form) and drops the form intro so the message
         stands alone, centred. Uses the dedicated status cap token so a
         fluidWidth form (--wz-max-width none) never feeds none into a min(). */
      :host([data-state]) .rf-card {
        max-width: var(--wz-status-max-width);
        text-align: center;
      }
      :host([data-state]) .rf-head {
        display: none;
      }
      .rf-form-error {
        color: var(--wz-error);
        font-size: calc(var(--wz-font-size) - 1px);
      }
      /* Batch 6 — optional "Powered by" footer under the card content; only
         rendered when branding.showPoweredBy is on. A static link to a
         hardcoded target — no merchant string reaches the href. */
      .rf-powered {
        margin: 14px 0 0;
        text-align: center;
        color: var(--wz-muted);
        font-size: calc(var(--wz-font-size) - 2px);
      }
      .rf-powered a {
        color: var(--wz-link);
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
  // Fields the shopper has interacted with (left once). "Reward early, punish
  // late": we validate a field only after its first blur, then re-check it live
  // on every change so a fix clears instantly. Non-reactive — fieldErrors drives
  // the re-render.
  private readonly touched = new Set<string>();
  @state() private formError = '';
  @state() private hp = '';
  // Batch 6 — whole seconds left on the post-submit redirect countdown; 0 hides
  // it. Only ticked when endings.showRedirectCountdown is on (see maybeRedirect).
  @state() private redirectRemaining = 0;

  // Per file-field selection. A single-file field holds 0..1 entries; a
  // multi-file field (maxFiles > 1) holds 0..maxFiles. Uploaded on submit.
  private files: Record<string, File[]> = {};
  private recaptchaInjected = false;
  // Number fields currently focused (blur-format / focus-raw display). Owned
  // here — per form instance — so the display state can't leak across concurrent
  // embeds or linger when a field is hidden without a blur (cleared on disconnect).
  private numberFocus = new Set<string>();
  // Ephemeral select-family UI state (dropdown combobox open/filter; radio/
  // dropdown/multi_select "Other" free-text mode), keyed by field.key. Owned
  // here — per form instance — so it can't leak across concurrent embeds; the
  // submitted value always lives in `values`, never here.
  private selectUi = new Map<string, SelectUiState>();
  // §a11y — the terminal status the panel focus was last moved to, so a
  // re-render in the same state doesn't repeatedly steal focus; reset once the
  // fillable form returns.
  private announcedState: Status | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.numberFocus.clear();
    this.selectUi.clear();
  }

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
    // Preselect select-family defaults so the preview mirrors the live embed.
    this.seedDefaultValues();
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
      this.captureDefaultValues();
      this.seedDefaultValues();
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

  /**
   * Seed hidden fields from their configured source — URL param (default),
   * cookie, referrer, landing URL, timestamp, or a fixed constant (§4). The
   * resolution + fallback + length-clamp logic is the pure, Zod-free
   * `resolveHiddenValue` shared with the server so verdicts don't drift. No
   * visible DOM.
   */
  private captureHiddenValues(): void {
    const fields = this.schema?.schema ?? [];
    if (!fields.some((f) => f.type === 'hidden')) return;
    const ctx = {
      search: window.location.search,
      cookie: typeof document !== 'undefined' ? document.cookie : '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      href: window.location.href,
      now: new Date(),
    };
    const next = { ...this.values };
    for (const field of fields) {
      if (field.type !== 'hidden') continue;
      const value = resolveHiddenValue(field, ctx);
      if (value !== null) next[field.key] = value;
    }
    this.values = next;
  }

  /** Seed field-level defaults into submit state (date `defaultTo: 'today'`), so
   * an untouched-but-prefilled field is actually submitted and clears required. */
  private captureDefaultValues(): void {
    const fields = this.schema?.schema ?? [];
    const next = { ...this.values };
    let changed = false;
    for (const field of fields) {
      if (
        field.type === 'date' &&
        field.validation?.defaultTo === 'today' &&
        this.isEmpty(next[field.key])
      ) {
        next[field.key] = todayISO();
        changed = true;
      }
    }
    if (changed) this.values = next;
  }

  /**
   * Seed select-family default values (§4.5 P0) — preselect a dropdown/radio
   * option or a multi_select subset when the field is UNTOUCHED (no value yet).
   * Server never trusts this; the shopper can change it. Mirrors the hidden
   * seed: only sets keys that are currently unset so it never clobbers input.
   */
  private seedDefaultValues(): void {
    const fields = this.schema?.schema ?? [];
    const next = { ...this.values };
    let changed = false;
    for (const field of fields) {
      if (next[field.key] !== undefined) continue;
      if (
        (field.type === 'dropdown' || field.type === 'radio') &&
        field.defaultValue !== undefined
      ) {
        next[field.key] = field.defaultValue;
        changed = true;
      } else if (field.type === 'multi_select' && field.defaultValue !== undefined) {
        next[field.key] = [...field.defaultValue];
        changed = true;
      }
    }
    if (changed) this.values = next;
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
      this.injectFontLink(
        `ratio-font-custom-${custom.replace(/ /g, '-')}`,
        customGoogleFontHref(custom),
      );
    } else {
      const family = typography?.fontFamily;
      if (family && family !== 'system') {
        this.injectFontLink(`ratio-font-${family}`, GOOGLE_FONT_HREF[family]);
      }
    }
    // §1.2 — heading/body pairing loads ≤2 more families (deduped by id). Each
    // uses the same fixed enum-keyed map — the merchant never supplies a URL.
    for (const role of [typography?.headingFont, typography?.bodyFont]) {
      if (role && role !== 'system') {
        this.injectFontLink(`ratio-font-${role}`, GOOGLE_FONT_HREF[role]);
      }
    }
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

  /**
   * After a successful submit, follow the form's redirectUrl (if any). Batch 6:
   * the delay honors `endings.redirectDelaySeconds` (absent ⇒ today's
   * REDIRECT_DELAY_MS), and when `endings.showRedirectCountdown` is on a
   * whole-second counter ticks down on the success panel. Both are additive —
   * an un-set form redirects after exactly 1500ms with no countdown, as today.
   */
  private maybeRedirect(): void {
    const url = this.schema?.redirectUrl;
    if (!url) return;
    const endings = this.appearance?.endings;
    const delayMs =
      typeof endings?.redirectDelaySeconds === 'number'
        ? endings.redirectDelaySeconds * 1000
        : REDIRECT_DELAY_MS;
    if (endings?.showRedirectCountdown) {
      this.redirectRemaining = Math.ceil(delayMs / 1000);
      const timer = setInterval(() => {
        this.redirectRemaining -= 1;
        if (this.redirectRemaining <= 0) clearInterval(timer);
      }, 1000);
    }
    setTimeout(() => {
      window.location.assign(url);
    }, delayMs);
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
    const errorCount = Object.keys(errors).length;
    if (errorCount > 0) {
      // Announce the failure (live region) and move focus to the first invalid
      // control so keyboard/AT users aren't stranded (WCAG 3.3.1 / 2.4.3).
      this.formError = `Please fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} and try again.`;
      await this.updateComplete;
      const firstInvalid = this.renderRoot.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    this.status = 'submitting';
    try {
      // File flow: presign → PUT bytes → attach object key(s). Each selected
      // file gets its own presign+PUT (distinct draft-scoped object key). The
      // stored shape is pinned to the field's config: a single-file field
      // attaches a scalar key (byte-identical), a multi-file field an array.
      const fileKeys: Record<string, string | string[]> = {};
      for (const field of schema.schema) {
        if (field.type !== 'file') continue;
        const selected = this.files[field.key] ?? [];
        if (selected.length === 0) continue;
        const keys: string[] = [];
        for (const file of selected) {
          const target = await client.requestUpload(this.formId, {
            fieldKey: field.key,
            contentType: file.type,
            size: file.size,
          });
          await client.uploadFile(target, file);
          keys.push(target.objectKey);
        }
        // keys is non-empty (selected.length === 0 skipped above).
        fileKeys[field.key] = (field.maxFiles ?? 1) > 1 ? keys : (keys[0] as string);
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
    // §1.3 — content alignment / card-vs-flat; the 'left'/'card' defaults reflect
    // nothing, so an un-themed form is unchanged.
    this.reflectAttr('data-align', l?.contentAlign === 'center' ? 'center' : null);
    this.reflectAttr('data-layout', l?.layoutMode === 'flat' ? 'flat' : null);
    // §2.1 — form-wide column count; '1' (today) reflects nothing.
    this.reflectAttr('data-cols', l?.columns && l.columns !== '1' ? l.columns : null);
    // §2.6 — frosted card only over an image backdrop with a blur radius.
    this.reflectAttr('data-card-blur', this.cardBlurActive ? 'on' : null);
    // Status screens shrink the card; the form (ready/submitting) keeps full width.
    const isStatusScreen = this.status !== 'ready' && this.status !== 'submitting';
    this.reflectAttr('data-state', isStatusScreen ? this.status : null);
    // §a11y — when a terminal status screen (success/closed/unavailable/error)
    // first appears, move focus to its live-region panel so a keyboard/SR
    // shopper is told the outcome; the submit button that had focus is gone by
    // now. 'loading' is transient and never grabs focus. announcedState guards
    // against re-focusing on unrelated re-renders and resets once the form
    // returns, so a later state change announces again.
    if (isStatusScreen && this.status !== 'loading') {
      if (this.status !== this.announcedState) {
        this.announcedState = this.status;
        (this.renderRoot.querySelector('.rf-status') as HTMLElement | null)?.focus();
      }
    } else {
      this.announcedState = null;
    }
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
        ${unsafeCSS(this.customFieldCss())}
      </style>
      <div class="rf-root">
        <div class="rf-bg"></div>
        <div class="rf-card">${this.renderHeader()}${this.renderState()}${this.renderPoweredBy()}</div>
      </div>`;
  }

  /**
   * Batch 6 — the optional "Powered by" footer. Rendered only when
   * branding.showPoweredBy is on; a static link to a hardcoded target, so no
   * merchant string ever reaches the href (Lit escapes the label regardless).
   */
  private renderPoweredBy(): TemplateResult | typeof nothing {
    if (!this.appearance?.branding?.showPoweredBy) return nothing;
    return html`<p class="rf-powered">
      Powered by
      <a href=${POWERED_BY_URL} target="_blank" rel="noopener noreferrer">Ratio Forms</a>
    </p>`;
  }

  /**
   * Merchant per-field custom CSS. Already sanitized + field-scoped by the
   * server (see shared `sanitize-field-css`), so each rule is prefixed with its
   * `[data-field="<key>"]` wrapper and carries no url()/@import/position:fixed/
   * host selectors — it can only reach its own field's subtree inside the shadow.
   * Emitted as a string into the theme <style> block (a second bound element
   * right after `</style>` trips Lit's happy-dom raw-text parse).
   */
  private customFieldCss(): string {
    return (this.schema?.schema ?? [])
      .map((f) => (f as { customCss?: string }).customCss)
      .filter((c): c is string => Boolean(c))
      .join('\n');
  }

  /**
   * Optional logo, cover, title, and description above the fields. Wrapped in a
   * static-first element: a nested template that *starts* with a binding drops
   * the following binding under Lit's happy-dom parse.
   */
  private renderHeader(): TemplateResult | typeof nothing {
    const schema = this.schema;
    if (!schema) return nothing;
    const logo = this.appearance?.logo;
    const cover = this.appearance?.cover;
    return html`<div class="rf-head">
      ${logo?.url ? this.renderLogo(logo) : nothing}
      ${cover?.url ? this.renderCover(cover) : nothing}
      <h2 class="rf-title">${schema.name}</h2>
      ${schema.description ? html`<p class="rf-desc">${schema.description}</p>` : nothing}
    </div>`;
  }

  /**
   * Batch 6 — the brand logo. Height comes from the enum→px token (§theme); the
   * per-logo alignment rides an inline `margin` style composed from the align
   * enum (SDK-built, never a merchant string) so it beats the contentAlign
   * host-centering rule. `alt` is the merchant's accessible name (Lit escapes
   * it); absent/'' ⇒ a decorative image, matching today's empty alt.
   */
  private renderLogo(logo: NonNullable<FormAppearance['logo']>): TemplateResult {
    const align = logo.align ?? 'left';
    // Fixed enum→margin map — inert CSS, no merchant value reaches it.
    const marginX =
      align === 'center'
        ? 'margin-left:auto;margin-right:auto'
        : align === 'right'
          ? 'margin-left:auto;margin-right:0'
          : 'margin-left:0;margin-right:auto';
    return html`<img class="rf-logo" src=${logo.url} alt=${logo.alt ?? ''} style=${marginX} />`;
  }

  /**
   * Batch 6 — the cover image, wrapped so the SDK-built dark overlay layer and
   * the optional blur/height (all from bounded-number tokens) clip to the card
   * radius. With overlay 0, blur 0, and height 180 the output is visually
   * identical to today's bare `.rf-cover`.
   */
  private renderCover(cover: NonNullable<FormAppearance['cover']>): TemplateResult {
    return html`<div class="rf-cover-wrap">
      <img class="rf-cover" src=${cover.url} alt=${cover.alt ?? ''} />
    </div>`;
  }

  private renderState(): TemplateResult {
    switch (this.status) {
      case 'loading':
        return html`<div class="rf-status" data-state="loading">Loading...</div>`;
      // Batch 6 — each non-success end state renders its structured panel when
      // the merchant authored `endings.<state>`, else today's exact template
      // (byte-identical when `endings` is absent).
      case 'closed':
        return (
          this.renderEndingPanel('closed') ??
          html`<div class="rf-status" data-state="closed" role="status" aria-live="polite" tabindex="-1">This form is closed.</div>`
        );
      case 'unavailable':
        return (
          this.renderEndingPanel('unavailable') ??
          html`<div class="rf-status" data-state="unavailable" role="status" aria-live="polite" tabindex="-1">
            This form is no longer available.
          </div>`
        );
      case 'error':
        return (
          this.renderEndingPanel('error') ??
          html`<div class="rf-status" data-state="error" role="status" aria-live="polite" tabindex="-1">
            This form could not be loaded.
          </div>`
        );
      case 'success':
        return this.renderSuccessPanel();
      default:
        return this.renderForm();
    }
  }

  /**
   * Batch 6 — the post-submit confirmation. Byte-identical to today (the exact
   * check glyph + successMessage) when no `endings.success` copy is authored and
   * no countdown is ticking. Otherwise the structured panel: an authored/def
   * icon, an optional heading, the body chained back to successMessage, and the
   * live redirect countdown when enabled (E4 back-compat chain E1a).
   */
  private renderSuccessPanel(): TemplateResult {
    const cfg = this.appearance?.endings?.success;
    const remaining = this.redirectRemaining;
    if (!cfg && remaining <= 0) {
      return html`<div class="rf-status rf-success" data-state="success" role="status" aria-live="polite" tabindex="-1">
        <svg
          class="rf-status-icon"
          viewBox="0 0 24 24"
          width="44"
          height="44"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.35"></circle>
          <path d="M7 12.4l3.3 3.3L17 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <p class="rf-status-msg">${this.schema?.successMessage ?? 'Thank you!'}</p>
      </div>`;
    }
    const icon = cfg?.icon ?? DEFAULT_ENDING_ICON.success;
    const body = cfg?.body ?? this.schema?.successMessage ?? 'Thank you!';
    return html`<div class="rf-status rf-success" data-state="success" role="status" aria-live="polite" tabindex="-1">
      ${this.renderEndingIcon(icon)}
      ${cfg?.heading ? html`<p class="rf-status-heading">${cfg.heading}</p>` : nothing}
      <p class="rf-status-msg">${body}</p>
      ${
        remaining > 0
          ? html`<p class="rf-countdown" aria-live="polite">Redirecting in ${remaining}s…</p>`
          : nothing
      }
    </div>`;
  }

  /**
   * Batch 6 — a structured panel for a non-success end state, or null when the
   * merchant authored no copy for it (the caller then falls back to today's
   * exact template). The body chains to the state's built-in default string, so
   * authoring only an icon/heading never drops the explanatory text.
   */
  private renderEndingPanel(
    state: 'closed' | 'expired' | 'unavailable' | 'error',
  ): TemplateResult | null {
    const cfg = this.appearance?.endings?.[state];
    if (!cfg) return null;
    const icon = cfg.icon ?? DEFAULT_ENDING_ICON[state];
    const body = cfg.body ?? DEFAULT_ENDING_BODY[state];
    return html`<div class="rf-status" data-state=${state} role="status" aria-live="polite" tabindex="-1">
      ${this.renderEndingIcon(icon)}
      ${cfg.heading ? html`<p class="rf-status-heading">${cfg.heading}</p>` : nothing}
      <p class="rf-status-msg">${body}</p>
    </div>`;
  }

  /** Batch 6 — a 44×44 end-panel glyph from the curated map; 'none' hides it. */
  private renderEndingIcon(icon: FormEndingIcon): TemplateResult | typeof nothing {
    if (icon === 'none') return nothing;
    return html`<svg
      class="rf-status-icon"
      viewBox="0 0 24 24"
      width="44"
      height="44"
      aria-hidden="true"
    >
      ${ENDING_ICONS[icon]}
    </svg>`;
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
      <div class="rf-form" role="form" @keydown=${this.onKeydown} @focusout=${this.onFieldBlur}>
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
          data-btn-variant=${this.submitVariant}
          aria-busy=${this.status === 'submitting' ? 'true' : nothing}
          aria-disabled=${this.status === 'submitting' ? 'true' : nothing}
          @click=${this.onSubmit}
        >
          ${this.status === 'submitting' ? this.renderSubmitLoader() : this.renderButtonIcon()}${
            this.status === 'submitting' ? 'Submitting...' : schema.submitLabel
          }
        </button>
      </div>
    `;
  }

  /** §1.5 — submit fill variant reflected on the button; 'solid' (today) sets
   * no attribute so the token-flip rules don't apply. */
  private get submitVariant(): string | typeof nothing {
    const variant = this.appearance?.layout?.buttonVariant ?? 'solid';
    return variant === 'solid' ? nothing : variant;
  }

  /** §1.8 — the busy spinner shown while submitting; 'none' shows text only.
   * A static-first template (avoids the happy-dom binding-first parse drop);
   * under prefers-reduced-motion the shared animation kill freezes it. */
  private renderSubmitLoader(): TemplateResult | typeof nothing {
    const loader = this.appearance?.layout?.submitLoader ?? 'spinner';
    if (loader !== 'spinner') return nothing;
    return html`<span class="rf-spinner" aria-hidden="true"></span>`;
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
    // A textarea with counterUnit:'words' counts words, not characters, for the
    // numerator (the limit/denominator stays the maxLength char cap).
    const value = String(this.values[field.key] ?? '');
    const len =
      counted.type === 'textarea' && counted.display?.counterUnit === 'words'
        ? value.trim() === ''
          ? 0
          : value.trim().split(/\s+/u).length
        : value.length;
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

  /** Render a content block (§1.3 / §4.15): heading, divider, paragraph, or
   * image. Appearance keys (§4.15) are optional/defaulted so an unstyled block
   * renders exactly as before; every value comes from a bounded enum/int (or a
   * re-checked https url), so nothing dynamic reaches an inline style or href. */
  private renderBlock(field: ContentBlockField): TemplateResult {
    // Heading returns early: the optional eyebrow and the <h> tag are two
    // children of the statically-wrapped block div. Visual size drives
    // font-size via data-size (decoupled from the semantic level); both the
    // eyebrow and heading bind as textContent — never innerHTML.
    if (field.type === 'heading') {
      const eyebrow = field.eyebrow
        ? html`<span class="rf-eyebrow">${field.eyebrow}</span>`
        : nothing;
      const body =
        field.level === 'h3'
          ? html`<h3 class="rf-heading" data-size=${field.size}>${field.text}</h3>`
          : html`<h2 class="rf-heading" data-size=${field.size}>${field.text}</h2>`;
      return html`<div
        class="rf-field rf-block"
        data-field=${field.key}
        data-width=${field.width ?? 'full'}
        data-align=${field.align}
      >
        ${eyebrow}${body}
      </div>`;
    }
    let inner: TemplateResult;
    switch (field.type) {
      case 'divider': {
        // variant flips the border-style (or drops the rule for 'spacer');
        // spacing is a bounded int, so an inline px value is injection-free. A
        // spacer carries its gap as an explicit height; a rule as vertical margin.
        const style =
          field.variant === 'spacer'
            ? `height:${field.spacing ?? 24}px`
            : field.spacing != null
              ? `margin:${field.spacing}px 0`
              : nothing;
        inner = html`<hr class="rf-divider" data-variant=${field.variant} style=${style} />`;
        break;
      }
      case 'paragraph':
        inner = html`<p class="rf-paragraph">${field.text}</p>`;
        break;
      case 'image': {
        // src via the audited https asset flow (validated in the schema),
        // loading=lazy, capped width.
        const img = html`<img
          class="rf-block-img"
          src=${field.url}
          alt=${field.alt ?? ''}
          loading="lazy"
        />`;
        // linkUrl (re-checked https, mirroring the accent hex guard) wraps the
        // image in a new-tab, noopener link; otherwise the bare image renders.
        const media =
          field.linkUrl && HTTPS_URL_RE.test(field.linkUrl)
            ? html`<a
                class="rf-block-link"
                href=${field.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                >${img}</a
              >`
            : img;
        const caption = field.caption
          ? html`<figcaption class="rf-figcaption">${field.caption}</figcaption>`
          : nothing;
        // <figure> carries align + size via data-*; the CSS caps width (size)
        // and aligns the figure with auto margins (align).
        inner = html`<figure
          class="rf-figure"
          data-align=${field.align}
          data-size=${field.size ?? nothing}
        >
          ${media}${caption}
        </figure>`;
        break;
      }
      case 'html':
        // Raw, merchant-authored HTML rendered as-is via `unsafeHTML` — NO
        // sanitization (a deliberate product decision by the owner). This
        // renders markup / embeds / iframes; a top-level inline <script> set
        // via innerHTML does NOT auto-execute, so pasted markup renders inert.
        inner = html`<div class="rf-html">${unsafeHTML(field.html)}</div>`;
        break;
    }
    // data-align on the wrapper aligns paragraph text (inherited text-align);
    // the image aligns itself via the figure's margins and the divider spans
    // full width, so both leave the wrapper unset.
    const align = field.type === 'paragraph' ? field.align : nothing;
    return html`<div
      class="rf-field rf-block"
      data-field=${field.key}
      data-width=${field.width ?? 'full'}
      data-align=${align}
    >
      ${inner}
    </div>`;
  }

  private setValue(key: string, value: unknown): void {
    this.values = { ...this.values, [key]: value };
    // Live re-check once a field is touched or already flagged, so a fix clears
    // the error immediately (and a newly-invalid value re-flags without a submit).
    if (this.touched.has(key) || this.fieldErrors[key]) {
      const field = (this.schema?.schema ?? []).find((f) => f.key === key);
      if (field) this.recheckField(field);
    }
  }

  /** Validate the field focus just left (its first blur → it becomes touched). */
  private onFieldBlur(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    const wrapper = target?.closest('[data-field]');
    const key = wrapper?.getAttribute('data-field');
    if (!key) return;
    // Grouped fields (radio / multi_select / checkbox-set / rating) fire a
    // focusout every time focus hops between their OWN options. Bailing when
    // the incoming focus (relatedTarget) is still inside this same wrapper
    // keeps the required/min error from flashing mid-selection; we only fall
    // through to validate once focus has truly left the field. A null
    // relatedTarget (focus left the document / crossed the shadow boundary)
    // counts as "left the field", so it validates like a single control.
    const nextFocus = event.relatedTarget as Node | null;
    if (nextFocus && wrapper?.contains(nextFocus)) return;
    const field = (this.schema?.schema ?? []).find((f) => f.key === key);
    if (!field || isContentBlock(field)) return;
    this.touched.add(key);
    this.recheckField(field);
  }

  /** Re-run one field's validator and patch its entry in `fieldErrors`. */
  private recheckField(field: FormField): void {
    const error = this.validateField(field);
    const next = { ...this.fieldErrors };
    if (error) next[field.key] = error;
    else delete next[field.key];
    this.fieldErrors = next;
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
      numberFocus: this.numberFocus,
      selectUi: this.selectUi,
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
