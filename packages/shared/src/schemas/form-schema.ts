import { z } from 'zod';

/**
 * The keystone Zod contract of the Form Builder (TRD §5): the schema of a
 * form definition itself. ONE schema validates in three places — the admin
 * builder (react-hook-form), the backend (form CRUD DTO +
 * schema-validator.service), and the storefront SDK (submission
 * pre-validation). Keep it dependency-free: plain Zod, no backend imports.
 */

/** The supported field types, in palette order. */
export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'phone',
  'dropdown',
  'multi_select',
  'date',
  'file',
  'radio',
  'checkbox',
  'number',
  'url',
  'rating',
  'hidden',
  // Content blocks (§1.3) — non-collectable display elements; see
  // FORM_NON_COLLECTABLE_FIELD_TYPES. They render inline but submit no data.
  'heading',
  'divider',
  'paragraph',
  'image',
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

// ── Per-field module registry (Phase 0 refactor) ───────────────
// Each field type owns its Zod member in ./fields/<type>/schema.ts; the
// registry assembles them into the discriminated-union tuple below. The shared
// primitives (baseFieldShape, hexColor, httpsAssetUrl, options/validation
// helpers) live in ./fields/_shared/base and are re-exported here so the public
// surface of this module is unchanged. Field-owned constants are likewise
// re-exported next to the field schemas.
import { FORM_INPUT_VARIANTS, hexColor, httpsAssetUrl } from './fields/_shared/base';
import { fieldSchemaMembers } from './fields/registry';

export {
  FORM_FIELD_WIDTHS,
  FORM_INPUT_VARIANTS,
  type FormFieldWidth,
  type FormInputVariant,
  formFieldKeySchema,
} from './fields/_shared/base';
export {
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  type FormFileAllowedMimeType,
} from './fields/file/schema';
export { FORM_HEADING_LEVELS, type FormHeadingLevel } from './fields/heading/schema';
export { FORM_RATING_ICONS, type FormRatingIcon } from './fields/rating/schema';
export {
  FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  FORM_TEXTAREA_HARD_MAX_LENGTH,
} from './fields/textarea/schema';

// ── Adornment capability matrix (§2.3) ─────────────────────────
// The single source of truth lives in the Zod-free ./form-adornments module so
// the storefront widget can import it at runtime without pulling Zod into its
// bundle; re-exported here so it still surfaces next to the field schemas and
// FORM_NON_COLLECTABLE_FIELD_TYPES/isCollectableFieldType for consistency.
export {
  FORM_ADORNABLE_FIELD_TYPES,
  FORM_COUNTER_FIELD_TYPES,
  isAdornable,
  supportsCounter,
} from './form-adornments';

// ── Content blocks (§1.3) ──────────────────────────────────────
// Non-collectable display elements: they occupy the ordered schema_json
// array and honor half-width + the key uniqueness check, but carry no
// label/required/validation and submit no data_json entry.
export const FORM_NON_COLLECTABLE_FIELD_TYPES = [
  'heading',
  'divider',
  'paragraph',
  'image',
] as const;

export type FormNonCollectableFieldType = (typeof FORM_NON_COLLECTABLE_FIELD_TYPES)[number];

/** True when a field type submits a value into `data_json` (§1.3). */
export const isCollectableFieldType = (type: FormFieldType): boolean =>
  !(FORM_NON_COLLECTABLE_FIELD_TYPES as readonly string[]).includes(type);

/** One form field — discriminated on `type` over the supported field types. */
export const formFieldSchema = z.discriminatedUnion('type', fieldSchemaMembers);

export type FormField = z.infer<typeof formFieldSchema>;

/**
 * The ordered field array persisted as `forms.schema_json`. Field keys must
 * be unique across the form — they key `data_json`, the CSV header, and the
 * webhook `fields` map.
 */
export const formFieldsSchema = z
  .array(formFieldSchema)
  .min(1, { message: 'a form needs at least one field' })
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate field key "${field.key}"`,
          path: [index, 'key'],
        });
      }
      seen.add(field.key);
    });
  });

export type FormFields = z.infer<typeof formFieldsSchema>;

// ── Appearance / theme ─────────────────────────────────────────
// Curated, XSS-safe font choices. Enum (not free string) so no value can
// smuggle CSS/url() into the shadow stylesheet. 'system' = current default.
export const FORM_FONT_FAMILIES = [
  'system', // system-ui stack (current default — no network font)
  'inter',
  'roboto',
  'open-sans',
  'lato',
  'montserrat',
  'poppins',
  'source-serif',
  'merriweather',
] as const;

export type FormFontFamily = (typeof FORM_FONT_FAMILIES)[number];

export const FORM_BUTTON_SHAPES = ['sharp', 'rounded', 'pill'] as const;
export const FORM_DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
// 'floating' (§1.4): label rests inside the input, animates up on focus/fill.
export const FORM_LABEL_POSITIONS = ['top', 'left', 'floating'] as const;
export const FORM_SHADOWS = ['none', 'sm', 'md'] as const;
export const FORM_BUTTON_ALIGNMENTS = ['left', 'center', 'right'] as const;

// Form-wide column count (§2.1): '1' = today's single column. '2'/'auto'
// reflect to a host data-cols attribute and drive a container-query grid;
// existing per-field width is still honored inside the grid.
export const FORM_COLUMN_MODES = ['1', '2', 'auto'] as const;
export type FormColumnMode = (typeof FORM_COLUMN_MODES)[number];

// Button size (§1.5): 'md' = today. Drives padding/font tokens only.
export const FORM_BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type FormButtonSize = (typeof FORM_BUTTON_SIZES)[number];

// Optional leading glyph on the submit button (§1.5). Rendered from a curated
// inline-SVG map keyed by the enum — never a URL, zero injection surface.
export const FORM_BUTTON_ICONS = ['none', 'arrow', 'check', 'send'] as const;
export type FormButtonIcon = (typeof FORM_BUTTON_ICONS)[number];

// Focus indicator style (§1.7): 'ring' = today's outline+ring. Never removes
// the ring entirely (WCAG); 'glow' uses box-shadow, 'border' uses border-color.
export const FORM_FOCUS_STYLES = ['ring', 'border', 'glow'] as const;
export type FormFocusStyle = (typeof FORM_FOCUS_STYLES)[number];

// Required-indicator style (§1.8): 'asterisk' = today. Pure label text.
export const FORM_REQUIRED_MARKS = ['asterisk', 'text', 'none'] as const;
export type FormRequiredMark = (typeof FORM_REQUIRED_MARKS)[number];

// Page background (§1.1). 'solid' + scrim 0 = today's flat pageBackground.
export const FORM_BG_TYPES = ['solid', 'gradient', 'image'] as const;
export type FormBgType = (typeof FORM_BG_TYPES)[number];

// Gradient direction — composed into a pure CSS gradient function (inert, no URL).
export const FORM_GRADIENT_DIRS = [
  'to bottom',
  'to top',
  'to right',
  'to bottom right',
  'radial',
] as const;
export type FormGradientDir = (typeof FORM_GRADIENT_DIRS)[number];

// Background image fit for the page area behind the card.
export const FORM_BG_IMAGE_FITS = ['cover', 'contain', 'repeat'] as const;
export type FormBgImageFit = (typeof FORM_BG_IMAGE_FITS)[number];

const appearanceColorsSchema = z
  .object({
    primary: hexColor.default('#0fb3a9'), // submit bg  (today's --wz-primary)
    background: hexColor.default('#ffffff'), // form card bg (today's --wz-bg)
    pageBackground: hexColor.default('#ffffff'), // area around the card; matches card today
    surface: hexColor.default('#ffffff'), // input bg   (defaults to bg today)
    text: hexColor.default('#1a1a1a'), // fg         (today's --wz-fg)
    muted: hexColor.default('#6b7280'), // muted text (today's --wz-muted)
    border: hexColor.default('#e5e7eb'), // borders    (today's --wz-border)
    error: hexColor.default('#c0392b'), // error text (today's literal)
    buttonText: hexColor.default('#ffffff'), // submit label (today's literal #fff)
  })
  .prefault({}); // parse the empty default so each sub-token default applies

const appearanceTypographySchema = z
  .object({
    fontFamily: z.enum(FORM_FONT_FAMILIES).default('system'),
    baseSize: z.number().int().min(12).max(20).default(14), // px; today ~14
  })
  .prefault({});

const appearanceLayoutSchema = z
  .object({
    radius: z.number().int().min(0).max(32).default(10), // today 10px
    density: z.enum(FORM_DENSITIES).default('comfortable'),
    maxWidth: z.number().int().min(280).max(960).default(640),
    buttonShape: z.enum(FORM_BUTTON_SHAPES).default('rounded'),
    fullWidthButton: z.boolean().default(false), // today: align-self flex-start
    buttonAlign: z.enum(FORM_BUTTON_ALIGNMENTS).default('left'), // today: left (flex-start)
    labelPosition: z.enum(FORM_LABEL_POSITIONS).default('top'),
    cardBorder: z.boolean().default(true), // today: card has a 1px border
    shadow: z.enum(FORM_SHADOWS).default('sm'), // card drop shadow
    // §1.2 — input look; 'outlined' = today (no host attribute).
    inputVariant: z.enum(FORM_INPUT_VARIANTS).default('outlined'),
    // §1.5 — submit button size + optional leading glyph; 'md'/'none' = today.
    buttonSize: z.enum(FORM_BUTTON_SIZES).default('md'),
    buttonIcon: z.enum(FORM_BUTTON_ICONS).default('none'),
    // §1.6 — spacing fine-tune; when set they override the density gap/padY.
    // Absent ⇒ density supplies the value ⇒ unchanged.
    fieldGap: z.number().int().min(6).max(40).optional(),
    inputPadY: z.number().int().min(4).max(18).optional(),
    // §1.7 — focus indicator; 'ring' + width 2 = today.
    focusStyle: z.enum(FORM_FOCUS_STYLES).default('ring'),
    focusWidth: z.number().int().min(1).max(4).default(2),
    // §1.8 — required-indicator; 'asterisk' = today.
    requiredMark: z.enum(FORM_REQUIRED_MARKS).default('asterisk'),
    // §2.1 — form-wide column count; '1' = today. Per-field width still honored.
    columns: z.enum(FORM_COLUMN_MODES).default('1'),
    // §2.4 — micro-animations toggle; false = today. Gated by
    // prefers-reduced-motion at render, so it never overrides the OS setting.
    animations: z.boolean().default(false),
  })
  .prefault({});

// Logo / cover images — optional brand assets. Only the https URL is stored;
// no dimensions or CSS, keeping the injection surface at zero (§5).
const appearanceLogoSchema = z.object({ url: httpsAssetUrl });
const appearanceCoverSchema = z.object({ url: httpsAssetUrl });

// §1.1 — the styled area *around* the card. Only hex/enum/https-url/bounded
// numbers are stored; themeVars() composes a pure CSS gradient function from
// gradientFrom/To/Dir (inert), and for type:'image' the SDK — not the merchant
// — builds url("…") after re-confirming https + no )/,/whitespace. Default
// type:'solid' + scrim:0 ⇒ today's flat pageBackground, unchanged.
const appearanceBackgroundSchema = z
  .object({
    type: z.enum(FORM_BG_TYPES).default('solid'),
    gradientFrom: hexColor.optional(),
    gradientTo: hexColor.optional(),
    gradientDir: z.enum(FORM_GRADIENT_DIRS).default('to bottom'),
    imageUrl: httpsAssetUrl.optional(),
    imageFit: z.enum(FORM_BG_IMAGE_FITS).default('cover'),
    scrim: z.number().min(0).max(0.8).default(0), // overlay opacity; 0 = none
    // §2.6 — frosted card: backdrop-filter blur radius (px); 0 = today (no blur).
    // Progressive enhancement over the always-on scrim; contrast never depends on it.
    cardBlur: z.number().min(0).max(20).default(0),
  })
  .prefault({});

export const appearanceSchema = z
  .object({
    colors: appearanceColorsSchema,
    typography: appearanceTypographySchema,
    layout: appearanceLayoutSchema,
    background: appearanceBackgroundSchema,
    logo: appearanceLogoSchema.optional(),
    cover: appearanceCoverSchema.optional(),
  })
  .strict(); // reject unknown keys — same posture as the field schemas

export type FormAppearance = z.infer<typeof appearanceSchema>;

/**
 * The form create/update body (POST/PUT /forms/api/forms[/:id]). `status`
 * and `id` are server-managed and deliberately absent.
 */
export const formInputSchema = z.object({
  name: z.string().min(1, { message: 'name is required' }).max(255),
  description: z.string().max(500).optional(), // form subtitle/heading
  schema: formFieldsSchema,
  submitLabel: z.string().min(1).max(100).default('Submit'),
  successMessage: z.string().min(1).default('Thank you! Your submission has been received.'),
  spamProtection: z.enum(['recaptcha', 'honeypot']).default('recaptcha'),
  notificationEmail: z
    .string()
    .email({ message: 'notificationEmail must be a valid email' })
    .max(320)
    .optional(),
  webhookUrl: z
    .string()
    .url({ message: 'webhookUrl must be a valid URL' })
    .max(2048)
    .refine((url) => url.startsWith('https://'), {
      message: 'webhookUrl must use https://',
    })
    .optional(),
  redirectUrl: z
    .string()
    .url({ message: 'redirectUrl must be a valid URL' })
    .max(2048)
    .refine((url) => url.startsWith('https://'), {
      message: 'redirectUrl must use https://',
    })
    .optional(),
  appearance: appearanceSchema.optional(),
});

export type FormInput = z.infer<typeof formInputSchema>;
