import { describe, expect, it } from 'vitest';
import {
  appearanceSchema,
  FORM_ADORNABLE_FIELD_TYPES,
  FORM_COUNTER_FIELD_TYPES,
  FORM_FIELD_TYPES,
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_NON_COLLECTABLE_FIELD_TYPES,
  FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  FORM_TEXTAREA_HARD_MAX_LENGTH,
  type FormAppearance,
  type FormField,
  formFieldSchema,
  formInputSchema,
  isAdornable,
  isCollectableFieldType,
  supportsCounter,
} from './form-schema';

/** One fully-configured field per type — the accept matrix (TDD §5). */
const textField = {
  key: 'first_name',
  type: 'text',
  label: 'First name',
  placeholder: 'Jane',
  required: true,
  validation: { pattern: '^[A-Za-z ]+$', minLength: 2, maxLength: 100 },
};
const textareaField = {
  key: 'message',
  type: 'textarea',
  label: 'Message',
  placeholder: 'Tell us more…',
  required: false,
  validation: { minLength: 10, maxLength: 8000 },
};
const emailField = {
  key: 'email',
  type: 'email',
  label: 'Email',
  placeholder: 'you@example.com',
  required: true,
};
const phoneField = { key: 'phone', type: 'phone', label: 'Phone (+91)', required: true };
const dropdownField = {
  key: 'topic',
  type: 'dropdown',
  label: 'Topic',
  required: true,
  options: ['Sales', 'Support'],
};
const multiSelectField = {
  key: 'interests',
  type: 'multi_select',
  label: 'Interests',
  required: false,
  options: ['Apparel', 'Footwear', 'Accessories'],
};
const dateField = { key: 'preferred_date', type: 'date', label: 'Preferred date', required: false };
const fileField = {
  key: 'attachment',
  type: 'file',
  label: 'Attachment',
  required: false,
  validation: { allowedMimeTypes: ['image/png', 'application/pdf'], maxBytes: 1024 * 1024 },
};
const radioField = {
  key: 'plan',
  type: 'radio',
  label: 'Plan',
  required: true,
  options: ['Basic', 'Pro'],
};
const checkboxField = {
  key: 'consent',
  type: 'checkbox',
  label: 'I agree to the privacy policy',
  required: true,
  linkUrl: 'https://merchant.example/privacy',
  linkText: 'privacy policy',
};
const numberField = {
  key: 'quantity',
  type: 'number',
  label: 'Quantity',
  required: false,
  validation: { min: 1, max: 100, step: 1, integer: true },
};
const urlField = {
  key: 'website',
  type: 'url',
  label: 'Website',
  placeholder: 'https://example.com',
  required: false,
};
const ratingField = {
  key: 'satisfaction',
  type: 'rating',
  label: 'How satisfied are you?',
  required: false,
  max: 10,
  icon: 'heart',
};
const hiddenField = {
  key: 'utm_source',
  type: 'hidden',
  label: 'UTM Source',
  paramName: 'utm_source',
};
const headingField = { key: 'section_1', type: 'heading', text: 'About you', level: 'h3' };
const dividerField = { key: 'rule_1', type: 'divider' };
const paragraphField = {
  key: 'intro',
  type: 'paragraph',
  text: 'Please fill in the details below and we will be in touch.',
};
const imageField = {
  key: 'banner',
  type: 'image',
  url: 'https://cdn.example/banner.png',
  alt: 'Our storefront',
};

const allFields = [
  textField,
  textareaField,
  emailField,
  phoneField,
  dropdownField,
  multiSelectField,
  dateField,
  fileField,
  radioField,
  checkboxField,
  numberField,
  urlField,
  ratingField,
  hiddenField,
  headingField,
  dividerField,
  paragraphField,
  imageField,
];

describe('formFieldSchema (discriminated union over the supported field types)', () => {
  it.each(
    allFields.map((f) => [f.type, f] as const),
  )('accepts a fully-configured %s field', (_type, field) => {
    const result = formFieldSchema.safeParse(field);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown field type', () => {
    expect(formFieldSchema.safeParse({ key: 'x', type: 'signature', label: 'X' }).success).toBe(
      false,
    );
  });

  it('rejects an empty label', () => {
    expect(formFieldSchema.safeParse({ ...textField, label: '' }).success).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(formFieldSchema.safeParse({ ...textField, key: '' }).success).toBe(false);
  });

  it('placeholder is optional', () => {
    const { placeholder: _p, ...noPlaceholder } = emailField;
    expect(formFieldSchema.safeParse(noPlaceholder).success).toBe(true);
  });

  it('required defaults to false when omitted', () => {
    const parsed = formFieldSchema.parse({ key: 'd', type: 'date', label: 'Date' });
    if (parsed.type === 'date') {
      expect(parsed.required).toBe(false);
    }
  });

  it('width defaults to full when omitted (single-column today)', () => {
    const parsed = formFieldSchema.parse({ key: 'd', type: 'date', label: 'Date' });
    expect(parsed.width).toBe('full');
  });

  it('accepts width half and rejects an unknown width', () => {
    expect(formFieldSchema.safeParse({ ...textField, width: 'half' }).success).toBe(true);
    expect(formFieldSchema.safeParse({ ...textField, width: 'third' }).success).toBe(false);
  });

  it('rejects a dropdown without options (missing or empty)', () => {
    const { options: _o, ...noOptions } = dropdownField;
    expect(formFieldSchema.safeParse(noOptions).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...dropdownField, options: [] }).success).toBe(false);
  });

  it('rejects a multi_select without options', () => {
    expect(formFieldSchema.safeParse({ ...multiSelectField, options: [] }).success).toBe(false);
  });

  it('rejects minLength > maxLength on text', () => {
    expect(
      formFieldSchema.safeParse({
        ...textField,
        validation: { minLength: 50, maxLength: 10 },
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid regex pattern on text', () => {
    expect(formFieldSchema.safeParse({ ...textField, validation: { pattern: '([' } }).success).toBe(
      false,
    );
  });

  it('textarea maxLength defaults to 5000 and is raisable to 10000 but not beyond', () => {
    const parsed = formFieldSchema.parse({ key: 'm', type: 'textarea', label: 'Msg' });
    expect(parsed.type).toBe('textarea');
    if (parsed.type === 'textarea') {
      expect(parsed.validation.maxLength).toBe(FORM_TEXTAREA_DEFAULT_MAX_LENGTH);
    }
    expect(
      formFieldSchema.safeParse({
        ...textareaField,
        validation: { maxLength: FORM_TEXTAREA_HARD_MAX_LENGTH },
      }).success,
    ).toBe(true);
    expect(
      formFieldSchema.safeParse({
        ...textareaField,
        validation: { maxLength: FORM_TEXTAREA_HARD_MAX_LENGTH + 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a file field with a disallowed mime in config', () => {
    expect(
      formFieldSchema.safeParse({
        ...fileField,
        validation: { allowedMimeTypes: ['image/gif'] },
      }).success,
    ).toBe(false);
  });

  it('rejects a file field with maxBytes above 5MB', () => {
    expect(
      formFieldSchema.safeParse({
        ...fileField,
        validation: { maxBytes: FORM_FILE_MAX_BYTES + 1 },
      }).success,
    ).toBe(false);
  });

  it('file field defaults: all allowed mimes + 5MB cap', () => {
    const parsed = formFieldSchema.parse({ key: 'f', type: 'file', label: 'File' });
    expect(parsed.type).toBe('file');
    if (parsed.type === 'file') {
      expect(parsed.validation.allowedMimeTypes).toEqual([...FORM_FILE_ALLOWED_MIME_TYPES]);
      expect(parsed.validation.maxBytes).toBe(FORM_FILE_MAX_BYTES);
    }
  });

  it('rejects a radio without options (missing or empty)', () => {
    const { options: _o, ...noOptions } = radioField;
    expect(formFieldSchema.safeParse(noOptions).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...radioField, options: [] }).success).toBe(false);
  });

  it('checkbox link is optional', () => {
    const parsed = formFieldSchema.parse({ key: 'c', type: 'checkbox', label: 'Agree' });
    expect(parsed.type).toBe('checkbox');
  });

  it('rejects a non-https checkbox linkUrl', () => {
    expect(
      formFieldSchema.safeParse({ ...checkboxField, linkUrl: 'http://insecure.example' }).success,
    ).toBe(false);
  });

  it('number validation is optional; integer defaults to false when validation present', () => {
    expect(formFieldSchema.safeParse({ key: 'n', type: 'number', label: 'N' }).success).toBe(true);
    const parsed = formFieldSchema.parse({ key: 'n', type: 'number', label: 'N', validation: {} });
    if (parsed.type === 'number') {
      expect(parsed.validation?.integer).toBe(false);
    }
  });

  it('rejects number validation with min > max', () => {
    expect(
      formFieldSchema.safeParse({ ...numberField, validation: { min: 100, max: 1 } }).success,
    ).toBe(false);
  });

  it('rejects number validation with a non-positive step', () => {
    expect(formFieldSchema.safeParse({ ...numberField, validation: { step: 0 } }).success).toBe(
      false,
    );
  });

  it('url field needs no extra config beyond the basics', () => {
    expect(formFieldSchema.safeParse({ key: 'u', type: 'url', label: 'URL' }).success).toBe(true);
  });

  it('rating defaults: max 5, icon star when omitted', () => {
    const parsed = formFieldSchema.parse({ key: 'r', type: 'rating', label: 'Rate' });
    expect(parsed.type).toBe('rating');
    if (parsed.type === 'rating') {
      expect(parsed.max).toBe(5);
      expect(parsed.icon).toBe('star');
    }
  });

  it('rejects a rating max outside 3..10', () => {
    expect(formFieldSchema.safeParse({ ...ratingField, max: 2 }).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...ratingField, max: 11 }).success).toBe(false);
  });

  it('rejects an unknown rating icon', () => {
    expect(formFieldSchema.safeParse({ ...ratingField, icon: 'thumbs' }).success).toBe(false);
  });

  it('rejects a hidden field without paramName', () => {
    const { paramName: _p, ...noParam } = hiddenField;
    expect(formFieldSchema.safeParse(noParam).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...hiddenField, paramName: '' }).success).toBe(false);
  });
});

describe('content-block field types (§1.3 — heading / divider / paragraph / image)', () => {
  it('accepts each content block with only key + width (no label/required)', () => {
    for (const block of [headingField, dividerField, paragraphField, imageField]) {
      expect(formFieldSchema.safeParse(block).success).toBe(true);
    }
  });

  it('content blocks default width to full and need no label', () => {
    const parsed = formFieldSchema.parse(dividerField);
    expect(parsed.type).toBe('divider');
    expect(parsed.width).toBe('full');
    expect('label' in parsed).toBe(false);
  });

  it('content blocks honor half width', () => {
    expect(formFieldSchema.safeParse({ ...imageField, width: 'half' }).success).toBe(true);
  });

  it('heading defaults level to h2 and rejects an out-of-set level', () => {
    const { level: _l, ...noLevel } = headingField;
    const parsed = formFieldSchema.parse(noLevel);
    if (parsed.type === 'heading') {
      expect(parsed.level).toBe('h2');
    }
    expect(formFieldSchema.safeParse({ ...headingField, level: 'h1' }).success).toBe(false);
  });

  it('rejects empty/oversized heading and paragraph text', () => {
    expect(formFieldSchema.safeParse({ ...headingField, text: '' }).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...headingField, text: 'a'.repeat(256) }).success).toBe(
      false,
    );
    expect(formFieldSchema.safeParse({ ...paragraphField, text: '' }).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...paragraphField, text: 'a'.repeat(2001) }).success).toBe(
      false,
    );
  });

  it('image block requires an https url; alt is optional', () => {
    const { alt: _a, ...noAlt } = imageField;
    expect(formFieldSchema.safeParse(noAlt).success).toBe(true);
    expect(
      formFieldSchema.safeParse({ ...imageField, url: 'http://cdn.example/x.png' }).success,
    ).toBe(false);
    expect(formFieldSchema.safeParse({ ...imageField, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
  });

  it('content blocks participate in the field-key uniqueness check', () => {
    const dup = formInputSchema.safeParse({
      name: 'Dup',
      schema: [
        { ...headingField, key: 'shared' },
        { ...dividerField, key: 'shared' },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it('isCollectableFieldType marks content blocks as non-collectable', () => {
    expect(FORM_NON_COLLECTABLE_FIELD_TYPES).toEqual(['heading', 'divider', 'paragraph', 'image']);
    for (const t of FORM_NON_COLLECTABLE_FIELD_TYPES) {
      expect(isCollectableFieldType(t)).toBe(false);
    }
    for (const t of ['text', 'email', 'file', 'rating', 'hidden'] as const) {
      expect(isCollectableFieldType(t)).toBe(true);
    }
  });
});

describe('per-field style override (§2.2) and adornments (§2.3)', () => {
  it('omits style and adornments by default (absent ⇒ inherits global)', () => {
    const parsed = formFieldSchema.parse(emailField);
    expect(parsed.type).toBe('email');
    if (parsed.type === 'email') {
      expect(parsed.style).toBeUndefined();
      expect(parsed.prefix).toBeUndefined();
      expect(parsed.suffix).toBeUndefined();
      expect(parsed.helpText).toBeUndefined();
      expect(parsed.errorMessage).toBeUndefined();
      expect(parsed.showCounter).toBe(false);
    }
  });

  it('accepts a partial style override built only from an input variant + hex accent', () => {
    const parsed = formFieldSchema.parse({
      ...emailField,
      style: { inputVariant: 'filled', accent: '#0fb3a9' },
    });
    if (parsed.type === 'email') {
      expect(parsed.style).toEqual({ inputVariant: 'filled', accent: '#0fb3a9' });
    }
    // Each key is independently optional.
    expect(formFieldSchema.safeParse({ ...emailField, style: { accent: '#123456' } }).success).toBe(
      true,
    );
    expect(formFieldSchema.safeParse({ ...emailField, style: {} }).success).toBe(true);
  });

  it('rejects a style override with a non-hex accent or unknown variant', () => {
    expect(formFieldSchema.safeParse({ ...emailField, style: { accent: 'teal' } }).success).toBe(
      false,
    );
    expect(
      formFieldSchema.safeParse({ ...emailField, style: { inputVariant: 'ghost' } }).success,
    ).toBe(false);
  });

  it('accepts prefix/suffix/helpText/errorMessage/showCounter within bounds', () => {
    const parsed = formFieldSchema.parse({
      ...numberField,
      prefix: '$',
      suffix: '.00',
      helpText: 'Enter an amount in USD.',
      errorMessage: 'Please enter a valid amount.',
      showCounter: true,
    });
    if (parsed.type === 'number') {
      expect(parsed.prefix).toBe('$');
      expect(parsed.suffix).toBe('.00');
      expect(parsed.helpText).toBe('Enter an amount in USD.');
      expect(parsed.errorMessage).toBe('Please enter a valid amount.');
      expect(parsed.showCounter).toBe(true);
    }
  });

  it('enforces the adornment length caps', () => {
    expect(formFieldSchema.safeParse({ ...textField, prefix: 'a'.repeat(9) }).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...textField, suffix: 'a'.repeat(9) }).success).toBe(false);
    expect(formFieldSchema.safeParse({ ...textField, helpText: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(formFieldSchema.safeParse({ ...textField, errorMessage: 'a'.repeat(501) }).success).toBe(
      false,
    );
    expect(formFieldSchema.safeParse({ ...textField, showCounter: 'yes' }).success).toBe(false);
  });
});

describe('adornment capability matrix (§2.3 — single source of truth)', () => {
  it('pins the adornable set to single-line text-like types', () => {
    expect(FORM_ADORNABLE_FIELD_TYPES).toEqual(['text', 'email', 'url', 'number']);
    // textarea is multiline; phone carries its own +91 chip.
    expect(isAdornable('textarea')).toBe(false);
    expect(isAdornable('phone')).toBe(false);
  });

  it('pins the counter set to types that support a maxLength', () => {
    expect(FORM_COUNTER_FIELD_TYPES).toEqual(['text', 'textarea']);
  });

  it('isAdornable / supportsCounter agree with their arrays across every field type', () => {
    for (const type of FORM_FIELD_TYPES) {
      expect(isAdornable(type)).toBe(
        (FORM_ADORNABLE_FIELD_TYPES as readonly string[]).includes(type),
      );
      expect(supportsCounter(type)).toBe(
        (FORM_COUNTER_FIELD_TYPES as readonly string[]).includes(type),
      );
    }
  });

  it('adornable and counter types are all collectable', () => {
    for (const type of [...FORM_ADORNABLE_FIELD_TYPES, ...FORM_COUNTER_FIELD_TYPES]) {
      expect(isCollectableFieldType(type)).toBe(true);
    }
  });
});

describe('appearanceSchema (theme contract)', () => {
  it('is optional on formInputSchema — an un-themed form parses without it', () => {
    const parsed = formInputSchema.parse({ name: 'Minimal', schema: [emailField] });
    expect(parsed.appearance).toBeUndefined();
  });

  it('an empty object fills every default (todays baked-in look)', () => {
    const parsed: FormAppearance = appearanceSchema.parse({});
    expect(parsed.colors.primary).toBe('#0fb3a9');
    expect(parsed.colors.background).toBe('#ffffff');
    expect(parsed.colors.pageBackground).toBe('#ffffff');
    expect(parsed.colors.surface).toBe('#ffffff');
    expect(parsed.colors.text).toBe('#1a1a1a');
    expect(parsed.colors.muted).toBe('#6b7280');
    expect(parsed.colors.border).toBe('#e5e7eb');
    expect(parsed.colors.error).toBe('#c0392b');
    expect(parsed.colors.buttonText).toBe('#ffffff');
    expect(parsed.typography.fontFamily).toBe('system');
    expect(parsed.typography.baseSize).toBe(14);
    expect(parsed.layout.radius).toBe(10);
    expect(parsed.layout.density).toBe('comfortable');
    expect(parsed.layout.maxWidth).toBe(640);
    expect(parsed.layout.buttonShape).toBe('rounded');
    expect(parsed.layout.fullWidthButton).toBe(false);
    expect(parsed.layout.buttonAlign).toBe('left');
    expect(parsed.layout.labelPosition).toBe('top');
    expect(parsed.layout.cardBorder).toBe(true);
    expect(parsed.layout.shadow).toBe('sm');
    // Tier-1 layout additions all default to today's value.
    expect(parsed.layout.inputVariant).toBe('outlined');
    expect(parsed.layout.inputSize).toBe('md');
    expect(parsed.layout.buttonSize).toBe('md');
    expect(parsed.layout.buttonIcon).toBe('none');
    expect(parsed.layout.fieldGap).toBeUndefined();
    expect(parsed.layout.inputPadY).toBeUndefined();
    expect(parsed.layout.focusStyle).toBe('ring');
    expect(parsed.layout.focusWidth).toBe(2);
    expect(parsed.layout.requiredMark).toBe('asterisk');
    // Tier-2 layout additions default to today's value.
    expect(parsed.layout.columns).toBe('1');
    expect(parsed.layout.animations).toBe(false);
    // §1.1 background defaults to a flat solid with no scrim ⇒ unchanged.
    expect(parsed.background.type).toBe('solid');
    expect(parsed.background.gradientDir).toBe('to bottom');
    expect(parsed.background.imageFit).toBe('cover');
    expect(parsed.background.scrim).toBe(0);
    expect(parsed.background.imageUrl).toBeUndefined();
    // §2.6 frosted-card blur defaults off.
    expect(parsed.background.cardBlur).toBe(0);
    expect(parsed.logo).toBeUndefined();
    expect(parsed.cover).toBeUndefined();
  });

  it('accepts the Tier-1 layout enums and rejects out-of-set values (§1.2/1.5/1.7/1.8)', () => {
    const ok = appearanceSchema.parse({
      layout: {
        inputVariant: 'filled',
        inputSize: 'lg',
        buttonSize: 'lg',
        buttonIcon: 'arrow',
        focusStyle: 'glow',
        requiredMark: 'text',
        labelPosition: 'floating',
      },
    });
    expect(ok.layout.inputVariant).toBe('filled');
    expect(ok.layout.inputSize).toBe('lg');
    expect(ok.layout.buttonSize).toBe('lg');
    expect(ok.layout.buttonIcon).toBe('arrow');
    expect(ok.layout.focusStyle).toBe('glow');
    expect(ok.layout.requiredMark).toBe('text');
    expect(ok.layout.labelPosition).toBe('floating');
    expect(appearanceSchema.safeParse({ layout: { inputVariant: 'ghost' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { buttonSize: 'xl' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { inputSize: 'xl' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { buttonIcon: 'rocket' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { focusStyle: 'none' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { requiredMark: 'star' } }).success).toBe(false);
  });

  it('enforces bounds on the §1.6/1.7 numeric fine-tune tokens', () => {
    expect(appearanceSchema.parse({ layout: { fieldGap: 20 } }).layout.fieldGap).toBe(20);
    expect(appearanceSchema.parse({ layout: { inputPadY: 10 } }).layout.inputPadY).toBe(10);
    expect(appearanceSchema.parse({ layout: { focusWidth: 4 } }).layout.focusWidth).toBe(4);
    expect(appearanceSchema.safeParse({ layout: { fieldGap: 5 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { fieldGap: 41 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { inputPadY: 3 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { inputPadY: 19 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { focusWidth: 0 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { focusWidth: 5 } }).success).toBe(false);
  });

  it('accepts a gradient background composed only from hex + enum direction', () => {
    const parsed = appearanceSchema.parse({
      background: {
        type: 'gradient',
        gradientFrom: '#0fb3a9',
        gradientTo: '#123456',
        gradientDir: 'radial',
      },
    });
    expect(parsed.background.type).toBe('gradient');
    expect(parsed.background.gradientFrom).toBe('#0fb3a9');
    expect(parsed.background.gradientDir).toBe('radial');
    expect(appearanceSchema.safeParse({ background: { gradientFrom: 'red' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ background: { gradientDir: 'diagonal' } }).success).toBe(
      false,
    );
  });

  it('accepts an image background with an https url and bounded scrim', () => {
    const parsed = appearanceSchema.parse({
      background: {
        type: 'image',
        imageUrl: 'https://cdn.example/bg.jpg',
        imageFit: 'contain',
        scrim: 0.5,
      },
    });
    expect(parsed.background.imageUrl).toBe('https://cdn.example/bg.jpg');
    expect(parsed.background.imageFit).toBe('contain');
    expect(parsed.background.scrim).toBe(0.5);
    expect(
      appearanceSchema.safeParse({ background: { imageUrl: 'http://cdn.example/bg.jpg' } }).success,
    ).toBe(false);
    expect(appearanceSchema.safeParse({ background: { scrim: -0.1 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ background: { scrim: 0.81 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ background: { imageFit: 'stretch' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ background: { type: 'video' } }).success).toBe(false);
  });

  it('accepts the §2.1 column modes and rejects out-of-set values', () => {
    expect(appearanceSchema.parse({ layout: { columns: '2' } }).layout.columns).toBe('2');
    expect(appearanceSchema.parse({ layout: { columns: 'auto' } }).layout.columns).toBe('auto');
    expect(appearanceSchema.safeParse({ layout: { columns: '3' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { columns: 3 } }).success).toBe(false);
  });

  it('accepts the §2.4 animations toggle and rejects a non-boolean', () => {
    expect(appearanceSchema.parse({ layout: { animations: true } }).layout.animations).toBe(true);
    expect(appearanceSchema.safeParse({ layout: { animations: 'yes' } }).success).toBe(false);
  });

  it('accepts a §2.6 card blur within 0..20 and rejects out-of-range values', () => {
    expect(appearanceSchema.parse({ background: { cardBlur: 12 } }).background.cardBlur).toBe(12);
    expect(appearanceSchema.parse({ background: { cardBlur: 20 } }).background.cardBlur).toBe(20);
    expect(appearanceSchema.safeParse({ background: { cardBlur: -1 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ background: { cardBlur: 21 } }).success).toBe(false);
  });

  it('rejects an unknown shadow value', () => {
    expect(appearanceSchema.safeParse({ layout: { shadow: 'xl' } }).success).toBe(false);
  });

  it('pageBackground defaults to the card background so the look is unchanged', () => {
    const parsed = appearanceSchema.parse({});
    expect(parsed.colors.pageBackground).toBe(parsed.colors.background);
  });

  it('pageBackground is an independent hex token', () => {
    const parsed = appearanceSchema.parse({ colors: { pageBackground: '#101010' } });
    expect(parsed.colors.pageBackground).toBe('#101010');
    expect(parsed.colors.background).toBe('#ffffff');
    expect(appearanceSchema.safeParse({ colors: { pageBackground: 'grey' } }).success).toBe(false);
  });

  it('buttonAlign accepts left/center/right and rejects unknown values', () => {
    expect(appearanceSchema.parse({ layout: { buttonAlign: 'center' } }).layout.buttonAlign).toBe(
      'center',
    );
    expect(appearanceSchema.parse({ layout: { buttonAlign: 'right' } }).layout.buttonAlign).toBe(
      'right',
    );
    expect(appearanceSchema.safeParse({ layout: { buttonAlign: 'justify' } }).success).toBe(false);
  });

  it('accepts optional https logo and cover URLs', () => {
    const parsed = appearanceSchema.parse({
      logo: { url: 'https://cdn.example/logo.png' },
      cover: { url: 'https://cdn.example/cover.jpg' },
    });
    expect(parsed.logo?.url).toBe('https://cdn.example/logo.png');
    expect(parsed.cover?.url).toBe('https://cdn.example/cover.jpg');
  });

  it('rejects non-https logo/cover URLs', () => {
    expect(
      appearanceSchema.safeParse({ logo: { url: 'http://cdn.example/logo.png' } }).success,
    ).toBe(false);
    expect(appearanceSchema.safeParse({ cover: { url: 'javascript:alert(1)' } }).success).toBe(
      false,
    );
  });

  it('a partial object is safe — only the set token overrides its default', () => {
    const parsed = appearanceSchema.parse({ colors: { primary: '#ff0000' } });
    expect(parsed.colors.primary).toBe('#ff0000');
    expect(parsed.colors.background).toBe('#ffffff');
  });

  it('accepts #rgb, #rrggbb and #rrggbbaa hex colors', () => {
    expect(appearanceSchema.safeParse({ colors: { primary: '#fff' } }).success).toBe(true);
    expect(appearanceSchema.safeParse({ colors: { primary: '#ffffff' } }).success).toBe(true);
    expect(appearanceSchema.safeParse({ colors: { primary: '#ffffffff' } }).success).toBe(true);
  });

  it('rejects non-hex color values (no rgb()/url()/named colors)', () => {
    expect(appearanceSchema.safeParse({ colors: { primary: 'red' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ colors: { primary: 'rgb(0,0,0)' } }).success).toBe(false);
    expect(
      appearanceSchema.safeParse({ colors: { primary: '#fff;background:url(x)' } }).success,
    ).toBe(false);
  });

  it('rejects an unknown top-level key (strict)', () => {
    expect(appearanceSchema.safeParse({ customCss: 'body{}' }).success).toBe(false);
  });

  it('rejects an unknown font family', () => {
    expect(appearanceSchema.safeParse({ typography: { fontFamily: 'comic-sans' } }).success).toBe(
      false,
    );
  });

  it('enforces numeric bounds on layout + typography', () => {
    expect(appearanceSchema.safeParse({ typography: { baseSize: 11 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ typography: { baseSize: 21 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { radius: 33 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { maxWidth: 279 } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ layout: { maxWidth: 961 } }).success).toBe(false);
  });

  it('accepts a full appearance object on formInputSchema', () => {
    const result = formInputSchema.safeParse({
      name: 'Themed',
      schema: [emailField],
      appearance: {
        colors: { primary: '#123456' },
        typography: { fontFamily: 'inter', baseSize: 16 },
        layout: { radius: 4, density: 'compact', buttonShape: 'pill' },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('formInputSchema (form CRUD contract)', () => {
  const validForm = {
    name: 'Contact us',
    schema: allFields,
    submitLabel: 'Send',
    successMessage: 'Thanks — we will get back to you.',
    spamProtection: 'recaptcha',
    notificationEmail: 'leads@merchant.example',
    webhookUrl: 'https://hooks.merchant.example/forms',
  };

  it('accepts a full form with every field type', () => {
    const result = formInputSchema.safeParse(validForm);
    expect(result.success).toBe(true);
  });

  it('fills defaults (submitLabel, successMessage, spamProtection)', () => {
    const parsed = formInputSchema.parse({ name: 'Minimal', schema: [emailField] });
    expect(parsed.submitLabel).toBe('Submit');
    expect(parsed.successMessage.length).toBeGreaterThan(0);
    expect(parsed.spamProtection).toBe('recaptcha');
  });

  it('rejects duplicate field keys across the form', () => {
    const dup = { ...validForm, schema: [emailField, { ...textField, key: 'email' }] };
    const result = formInputSchema.safeParse(dup);
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(formInputSchema.safeParse({ ...validForm, name: '' }).success).toBe(false);
  });

  it('rejects a missing schema', () => {
    const { schema: _s, ...noSchema } = validForm;
    expect(formInputSchema.safeParse(noSchema).success).toBe(false);
  });

  it('rejects an empty schema (min 1 field)', () => {
    expect(formInputSchema.safeParse({ ...validForm, schema: [] }).success).toBe(false);
  });

  it('rejects an unknown spamProtection mode', () => {
    expect(formInputSchema.safeParse({ ...validForm, spamProtection: 'captcha' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid notificationEmail', () => {
    expect(
      formInputSchema.safeParse({ ...validForm, notificationEmail: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('rejects a non-https webhookUrl', () => {
    expect(
      formInputSchema.safeParse({ ...validForm, webhookUrl: 'http://insecure.example' }).success,
    ).toBe(false);
  });

  it('description is optional and capped at 500 chars', () => {
    expect(
      formInputSchema.safeParse({ ...validForm, description: 'A short subtitle' }).success,
    ).toBe(true);
    expect(formInputSchema.parse({ name: 'X', schema: [emailField] }).description).toBeUndefined();
    expect(formInputSchema.safeParse({ ...validForm, description: 'a'.repeat(501) }).success).toBe(
      false,
    );
  });

  it('redirectUrl accepts https and rejects non-https', () => {
    expect(
      formInputSchema.safeParse({ ...validForm, redirectUrl: 'https://merchant.example/thanks' })
        .success,
    ).toBe(true);
    expect(
      formInputSchema.safeParse({ ...validForm, redirectUrl: 'http://insecure.example' }).success,
    ).toBe(false);
  });

  it('the inferred FormField type discriminates on `type`', () => {
    const parsed: FormField = formFieldSchema.parse(dropdownField);
    if (parsed.type === 'dropdown') {
      expect(parsed.options).toEqual(['Sales', 'Support']);
    }
  });
});
