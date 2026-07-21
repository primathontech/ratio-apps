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

/** Upload allowlist — presigned PUTs are constrained to exactly these. */
export const FORM_FILE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type FormFileAllowedMimeType = (typeof FORM_FILE_ALLOWED_MIME_TYPES)[number];

/** Hard upload ceiling — 5 MB (PRD F2/F3; S3 content-length-range). */
export const FORM_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** Textarea length: 5,000 default, merchant-raisable to 10,000 (PRD F13). */
export const FORM_TEXTAREA_DEFAULT_MAX_LENGTH = 5000;
export const FORM_TEXTAREA_HARD_MAX_LENGTH = 10000;

/**
 * Field key — becomes the JSON key in `data_json`, the CSV header, and the
 * `fields` key of the `form.submitted` payload. Machine-safe by construction.
 */
export const formFieldKeySchema = z
  .string()
  .min(1, { message: 'field key is required' })
  .max(64, { message: 'field key must be at most 64 characters' })
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message: 'field key must start with a letter and contain only letters, digits, and underscores',
  });

/** Field render width — two consecutive 'half' fields sit side-by-side. */
export const FORM_FIELD_WIDTHS = ['full', 'half'] as const;

export type FormFieldWidth = (typeof FORM_FIELD_WIDTHS)[number];

// Asset URL for hosted images (content-block image, logo/cover, background) —
// https-only, same posture as webhookUrl/linkUrl so nothing dynamic (http,
// data:, javascript:) reaches an <img src> or CSS url().
const httpsAssetUrl = z
  .string()
  .url({ message: 'must be a valid URL' })
  .max(2048)
  .refine((url) => url.startsWith('https://'), { message: 'must use https://' });

// Hex only (#rgb / #rrggbb / #rrggbbaa). Rejects rgb()/hsl()/url()/named
// colors so nothing dynamic reaches the CSS var. max length is a cheap DoS
// guard. Shared by the appearance colors and the per-field accent override.
const hexColor = z
  .string()
  .trim()
  .max(9)
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color');

// Input look (§1.2): 'outlined' = today. 'filled'/'underlined' reflect to a
// host data-input attribute and flip only private tokens — no new colors. A
// per-field override (§2.2) may pin one field to a different variant.
export const FORM_INPUT_VARIANTS = ['outlined', 'filled', 'underlined'] as const;
export type FormInputVariant = (typeof FORM_INPUT_VARIANTS)[number];

/** Shared per-field basics — every field type carries these. */
const baseFieldShape = {
  key: formFieldKeySchema,
  label: z.string().min(1, { message: 'label is required' }).max(255),
  placeholder: z.string().max(255).optional(),
  required: z.boolean().default(false),
  width: z.enum(FORM_FIELD_WIDTHS).default('full'), // 'full' = today's single-column
  // §2.2 — per-field style override. Optional so absent = inherits the global
  // inputVariant/accent; when set, the SDK scopes it to that field's element
  // (setProperty on --wz-* / a per-wrapper data-input attribute), never global.
  style: z
    .object({
      inputVariant: z.enum(FORM_INPUT_VARIANTS).optional(),
      accent: hexColor.optional(),
    })
    .optional(),
  // §2.3 — per-field adornments (all text nodes, zero injection surface).
  // prefix/suffix/help apply to text-like inputs; counter only meaningful
  // alongside a validation.maxLength. Absent ⇒ nothing rendered ⇒ unchanged.
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(8).optional(),
  helpText: z.string().max(200).optional(),
  showCounter: z.boolean().default(false),
};

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

/** A merchant-supplied validation regex — must compile. */
const regexPatternSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (pattern) => {
      try {
        new RegExp(pattern);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'pattern must be a valid regular expression' },
  );

const minMaxConsistent = (v: {
  minLength?: number | undefined;
  maxLength?: number | undefined;
}): boolean => v.minLength === undefined || v.maxLength === undefined || v.minLength <= v.maxLength;

const MIN_MAX_MESSAGE = { message: 'minLength must be less than or equal to maxLength' };

/** text: optional regex + length bounds. */
const textValidationSchema = z
  .object({
    pattern: regexPatternSchema.optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

/** textarea: length bounds; max defaults to 5,000 and is capped at 10,000. */
const textareaValidationSchema = z
  .object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z
      .number()
      .int()
      .min(1)
      .max(FORM_TEXTAREA_HARD_MAX_LENGTH, {
        message: `textarea maxLength cannot exceed ${FORM_TEXTAREA_HARD_MAX_LENGTH}`,
      })
      .default(FORM_TEXTAREA_DEFAULT_MAX_LENGTH),
  })
  .refine(minMaxConsistent, MIN_MAX_MESSAGE);

/** file: mime allowlist (subset of the platform allowlist) + size cap ≤ 5MB. */
const fileValidationSchema = z.object({
  allowedMimeTypes: z
    .array(z.enum(FORM_FILE_ALLOWED_MIME_TYPES))
    .min(1, { message: 'at least one allowed file type is required' })
    .default([...FORM_FILE_ALLOWED_MIME_TYPES]),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(FORM_FILE_MAX_BYTES, { message: 'maxBytes cannot exceed 5MB' })
    .default(FORM_FILE_MAX_BYTES),
});

/** dropdown / multi_select / radio choices — at least one non-empty option. */
const optionsSchema = z
  .array(z.string().min(1, { message: 'options cannot be empty strings' }))
  .min(1, { message: 'at least one option is required' });

const numberMinMaxConsistent = (v: { min?: number | undefined; max?: number | undefined }): boolean =>
  v.min === undefined || v.max === undefined || v.min <= v.max;

/** number: optional numeric bounds + step; `integer` forbids decimals. */
const numberValidationSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    integer: z.boolean().default(false),
  })
  .refine(numberMinMaxConsistent, { message: 'min must be less than or equal to max' });

const textFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('text'),
  validation: textValidationSchema.optional(),
});

const textareaFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('textarea'),
  validation: textareaValidationSchema.default({
    maxLength: FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  }),
});

/** Email format is enforced at submit-time; no extra config beyond basics. */
const emailFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('email'),
});

/** Phone is +91 + 10 digits in v1 — enforced at submit-time, no config here. */
const phoneFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('phone'),
});

const dropdownFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('dropdown'),
  options: optionsSchema,
});

const multiSelectFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('multi_select'),
  options: optionsSchema,
});

const dateFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('date'),
});

const fileFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('file'),
  validation: fileValidationSchema.default({
    allowedMimeTypes: [...FORM_FILE_ALLOWED_MIME_TYPES],
    maxBytes: FORM_FILE_MAX_BYTES,
  }),
});

/** radio: single-choice — reuses the dropdown/multi_select options shape. */
const radioFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('radio'),
  options: optionsSchema,
});

/** checkbox: single consent box; optional policy link (https-only). */
const checkboxFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('checkbox'),
  linkUrl: z
    .string()
    .url({ message: 'linkUrl must be a valid URL' })
    .max(2048)
    .refine((url) => url.startsWith('https://'), { message: 'linkUrl must use https://' })
    .optional(),
  linkText: z.string().min(1).max(255).optional(),
});

/** number: optional min/max/step + integer flag; enforced at submit-time. */
const numberFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('number'),
  validation: numberValidationSchema.optional(),
});

/** URL format is enforced at submit-time (like email); no extra config here. */
const urlFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('url'),
});

/** Star/heart glyphs for the rating control. Enum keeps the glyph curated. */
export const FORM_RATING_ICONS = ['star', 'heart'] as const;

export type FormRatingIcon = (typeof FORM_RATING_ICONS)[number];

/** rating: a 3..10 scale rendered as star/heart glyphs. */
const ratingFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('rating'),
  max: z.number().int().min(3).max(10).default(5),
  icon: z.enum(FORM_RATING_ICONS).default('star'),
});

/** hidden: captured from URLSearchParams (UTM etc), never user-visible. */
const hiddenFieldSchema = z.object({
  ...baseFieldShape,
  type: z.literal('hidden'),
  paramName: z
    .string()
    .min(1, { message: 'paramName is required' })
    .max(64, { message: 'paramName must be at most 64 characters' }),
});

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

/** Heading levels for the heading block — curated so no h1 collides with the page. */
export const FORM_HEADING_LEVELS = ['h2', 'h3'] as const;

export type FormHeadingLevel = (typeof FORM_HEADING_LEVELS)[number];

// Content blocks share only key + width — no label/required/validation. Keeping
// `key` lets the uniqueness superRefine and half-width pairing treat them uniformly.
const contentBlockBaseShape = {
  key: formFieldKeySchema,
  width: z.enum(FORM_FIELD_WIDTHS).default('full'),
};

/** heading: a short section title rendered as <h2>/<h3>. */
const headingFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('heading'),
  text: z.string().min(1, { message: 'heading text is required' }).max(255),
  level: z.enum(FORM_HEADING_LEVELS).default('h2'),
});

/** divider: a horizontal rule; no config beyond key + width. */
const dividerFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('divider'),
});

/** paragraph: a block of copy rendered via textContent (never innerHTML). */
const paragraphFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('paragraph'),
  text: z.string().min(1, { message: 'paragraph text is required' }).max(2000),
});

/** image: a display image; reuses the audited https-only asset flow. */
const imageFieldSchema = z.object({
  ...contentBlockBaseShape,
  type: z.literal('image'),
  url: httpsAssetUrl,
  alt: z.string().max(255).optional(),
});

/** One form field — discriminated on `type` over the supported field types. */
export const formFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  textareaFieldSchema,
  emailFieldSchema,
  phoneFieldSchema,
  dropdownFieldSchema,
  multiSelectFieldSchema,
  dateFieldSchema,
  fileFieldSchema,
  radioFieldSchema,
  checkboxFieldSchema,
  numberFieldSchema,
  urlFieldSchema,
  ratingFieldSchema,
  hiddenFieldSchema,
  headingFieldSchema,
  dividerFieldSchema,
  paragraphFieldSchema,
  imageFieldSchema,
]);

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
