import {
  appearanceSchema,
  FORM_FIELD_TYPES,
  type FormField,
  formFieldsSchema,
  formInputSchema,
} from '@shared/schemas/form-schema';
import { describe, expect, it } from 'vitest';
import {
  type BuilderState,
  builderReducer,
  DEFAULT_APPEARANCE,
  EMPTY_BUILDER_STATE,
  slugifyKey,
  toFormInput,
} from './builder-state';

function loaded(fields: FormField[] = []): BuilderState {
  return builderReducer(EMPTY_BUILDER_STATE, {
    type: 'load',
    form: {
      name: 'Contact us',
      schema: fields,
      submitLabel: 'Send',
      successMessage: 'Thanks!',
      spamProtection: 'recaptcha',
      notificationEmail: null,
      webhookUrl: null,
    },
  });
}

describe('builderReducer', () => {
  it('adds a field of every supported type with schema-valid defaults', () => {
    let state = loaded();
    for (const fieldType of FORM_FIELD_TYPES) {
      state = builderReducer(state, { type: 'addField', fieldType });
    }
    expect(state.fields).toHaveLength(FORM_FIELD_TYPES.length);
    expect(state.fields.map((f) => f.type)).toEqual([...FORM_FIELD_TYPES]);
    // Every freshly-added field must already satisfy the shared schema.
    const parsed = formFieldsSchema.safeParse(state.fields);
    expect(parsed.success).toBe(true);
    expect(state.dirty).toBe(true);
    // The newest field is auto-selected for the settings panel.
    expect(state.selectedKey).toBe(state.fields.at(-1)?.key);
  });

  it('mints unique keys when the same type is added twice', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    const keys = state.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('inserts at an explicit index (palette drop between fields)', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    state = builderReducer(state, { type: 'addField', fieldType: 'email' });
    state = builderReducer(state, { type: 'addField', fieldType: 'date', index: 1 });
    expect(state.fields.map((f) => f.type)).toEqual(['text', 'date', 'email']);
  });

  it('reorders fields (dnd-kit onDragEnd lands here)', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    state = builderReducer(state, { type: 'addField', fieldType: 'email' });
    state = builderReducer(state, { type: 'addField', fieldType: 'phone' });
    state = builderReducer(state, { type: 'reorderField', from: 2, to: 0 });
    expect(state.fields.map((f) => f.type)).toEqual(['phone', 'text', 'email']);
    // Out-of-range indexes are a no-op, not a crash.
    expect(builderReducer(state, { type: 'reorderField', from: 0, to: 9 })).toBe(state);
  });

  it('removes a field and clears its selection', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    const key = state.fields[0]?.key as string;
    state = builderReducer(state, { type: 'selectField', key });
    state = builderReducer(state, { type: 'removeField', key });
    expect(state.fields).toHaveLength(0);
    expect(state.selectedKey).toBeNull();
  });

  it('configures a field (label, placeholder, required, validation)', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    const key = state.fields[0]?.key as string;
    state = builderReducer(state, {
      type: 'updateField',
      key,
      patch: {
        placeholder: 'Your name',
        required: true,
        validation: { minLength: 2, maxLength: 80 },
      },
    });
    const field = state.fields[0] as Extract<FormField, { type: 'text' }>;
    expect(field.placeholder).toBe('Your name');
    expect(field.required).toBe(true);
    expect(field.validation).toEqual({ minLength: 2, maxLength: 80 });
  });

  it('sets a field width and round-trips it through the save payload', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    const key = state.fields[0]?.key as string;
    // A fresh field defaults to full width.
    expect(state.fields[0]?.width).toBe('full');
    state = builderReducer(state, { type: 'updateField', key, patch: { width: 'half' } });
    expect(state.fields[0]?.width).toBe('half');
    const payload = toFormInput(state);
    const parsed = formInputSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.schema[0]?.width).toBe('half');
  });

  it('auto-slugs the key from the label until the key is hand-edited', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    const key = state.fields[0]?.key as string;
    state = builderReducer(state, { type: 'updateField', key, patch: { label: 'Full Name!' } });
    expect(state.fields[0]?.key).toBe('full_name');
    // Selection follows the renamed key.
    expect(state.selectedKey).toBe('full_name');
    // Hand-edit the key, then change the label again — the key must stick.
    state = builderReducer(state, {
      type: 'updateField',
      key: 'full_name',
      patch: { key: 'customer' },
    });
    state = builderReducer(state, {
      type: 'updateField',
      key: 'customer',
      patch: { label: 'Something else' },
    });
    expect(state.fields[0]?.key).toBe('customer');
  });

  it("prevents renaming a field onto another field's key (duplicate keys)", () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    state = builderReducer(state, { type: 'addField', fieldType: 'email' });
    const [first, second] = state.fields.map((f) => f.key) as [string, string];
    const next = builderReducer(state, {
      type: 'updateField',
      key: second,
      patch: { key: first },
    });
    // No-op: the transition is rejected, keys stay unique.
    expect(next).toBe(state);
    expect(new Set(next.fields.map((f) => f.key)).size).toBe(2);
  });

  it('updates form meta and tracks dirtiness across save', () => {
    let state = loaded();
    expect(state.dirty).toBe(false);
    state = builderReducer(state, { type: 'updateMeta', patch: { name: 'Waitlist' } });
    expect(state.meta.name).toBe('Waitlist');
    expect(state.dirty).toBe(true);
    state = builderReducer(state, { type: 'markSaved' });
    expect(state.dirty).toBe(false);
  });

  it('toFormInput emits a formInputSchema-valid payload and omits blank optionals', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    const payload = toFormInput(state);
    expect('notificationEmail' in payload).toBe(false);
    expect('webhookUrl' in payload).toBe(false);
    expect(formInputSchema.safeParse(payload).success).toBe(true);
    state = builderReducer(state, {
      type: 'updateMeta',
      patch: { notificationEmail: 'leads@shop.in', webhookUrl: 'https://hooks.example/x' },
    });
    const full = toFormInput(state);
    expect(full.notificationEmail).toBe('leads@shop.in');
    expect(formInputSchema.safeParse(full).success).toBe(true);
  });

  it('hydrates and round-trips description + redirectUrl', () => {
    let state = builderReducer(EMPTY_BUILDER_STATE, {
      type: 'load',
      form: {
        name: 'Contact us',
        schema: [
          {
            key: 'name',
            label: 'Name',
            required: true,
            type: 'text',
            width: 'full',
            showCounter: false,
          },
        ],
        submitLabel: 'Send',
        successMessage: 'Thanks!',
        spamProtection: 'recaptcha',
        notificationEmail: null,
        webhookUrl: null,
        description: 'We reply within a day',
        redirectUrl: 'https://shop.in/thanks',
      },
    });
    expect(state.meta.description).toBe('We reply within a day');
    expect(state.meta.redirectUrl).toBe('https://shop.in/thanks');

    const payload = toFormInput(state);
    expect(payload.description).toBe('We reply within a day');
    expect(payload.redirectUrl).toBe('https://shop.in/thanks');
    expect(formInputSchema.safeParse(payload).success).toBe(true);

    // Blank values are omitted from the payload entirely.
    state = builderReducer(state, {
      type: 'updateMeta',
      patch: { description: '', redirectUrl: '' },
    });
    const blank = toFormInput(state);
    expect('description' in blank).toBe(false);
    expect('redirectUrl' in blank).toBe(false);
  });

  it('builds schema-valid content blocks (heading/divider/paragraph/image) with no label/required', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'heading' });
    state = builderReducer(state, { type: 'addField', fieldType: 'divider' });
    state = builderReducer(state, { type: 'addField', fieldType: 'paragraph' });
    state = builderReducer(state, { type: 'addField', fieldType: 'image' });
    expect(state.fields.map((f) => f.type)).toEqual(['heading', 'divider', 'paragraph', 'image']);
    // Content blocks carry key + width but never label/required.
    for (const field of state.fields) {
      expect('label' in field).toBe(false);
      expect('required' in field).toBe(false);
    }
    // The seeded image url is a valid https asset, so the whole set parses.
    expect(formFieldsSchema.safeParse(state.fields).success).toBe(true);
    const payload = toFormInput(state);
    expect(formInputSchema.safeParse(payload).success).toBe(true);
  });

  it('makeField builds schema-valid url/rating/hidden fields', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'rating' });
    state = builderReducer(state, { type: 'addField', fieldType: 'hidden' });
    const rating = state.fields.find((f) => f.type === 'rating');
    const hidden = state.fields.find((f) => f.type === 'hidden');
    expect(rating).toMatchObject({ type: 'rating', max: 5, icon: 'star' });
    expect(hidden).toMatchObject({ type: 'hidden' });
    expect((hidden as Extract<FormField, { type: 'hidden' }>).paramName.length).toBeGreaterThan(0);
    expect(formFieldsSchema.safeParse(state.fields).success).toBe(true);
  });
});

describe('appearance', () => {
  it('DEFAULT_APPEARANCE equals the shared schema defaults', () => {
    expect(DEFAULT_APPEARANCE).toEqual(appearanceSchema.parse({}));
    expect(DEFAULT_APPEARANCE.colors.primary).toBe('#0fb3a9');
    expect(DEFAULT_APPEARANCE.layout.maxWidth).toBe(640);
  });

  it('hydrates appearance from a loaded form', () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      colors: { ...DEFAULT_APPEARANCE.colors, primary: '#123456' },
    };
    const state = builderReducer(EMPTY_BUILDER_STATE, {
      type: 'load',
      form: {
        name: 'Themed',
        schema: [],
        submitLabel: 'Send',
        successMessage: 'Thanks!',
        spamProtection: 'recaptcha',
        notificationEmail: null,
        webhookUrl: null,
        appearance,
      },
    });
    expect(state.meta.appearance?.colors.primary).toBe('#123456');
  });

  it('updateAppearance deep-merges a single token onto the defaults', () => {
    let state = loaded();
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { colors: { primary: '#ff0000' } },
    });
    // The edited token changes; every other token keeps its default.
    expect(state.meta.appearance?.colors.primary).toBe('#ff0000');
    expect(state.meta.appearance?.colors.background).toBe(DEFAULT_APPEARANCE.colors.background);
    expect(state.meta.appearance?.layout.radius).toBe(DEFAULT_APPEARANCE.layout.radius);
    expect(state.dirty).toBe(true);

    // A second edit in another group must not clobber the first.
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { layout: { density: 'spacious' } },
    });
    expect(state.meta.appearance?.colors.primary).toBe('#ff0000');
    expect(state.meta.appearance?.layout.density).toBe('spacious');
  });

  it('merges pageBackground and buttonAlign and keeps them through the payload', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { colors: { pageBackground: '#101010' } },
    });
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { layout: { buttonAlign: 'center' } },
    });
    // Each edit merges onto the defaults without clobbering the other.
    expect(state.meta.appearance?.colors.pageBackground).toBe('#101010');
    expect(state.meta.appearance?.colors.background).toBe(DEFAULT_APPEARANCE.colors.background);
    expect(state.meta.appearance?.layout.buttonAlign).toBe('center');

    const payload = toFormInput(state);
    const appearance = payload.appearance as {
      colors: { pageBackground: string };
      layout: { buttonAlign: string };
    };
    expect(appearance.colors.pageBackground).toBe('#101010');
    expect(appearance.layout.buttonAlign).toBe('center');
    expect(formInputSchema.safeParse(payload).success).toBe(true);
  });

  it('deep-merges a background patch and round-trips it through the payload (§1.1)', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { background: { type: 'gradient', gradientFrom: '#101010' } },
    });
    // A second edit must not clobber the first background field.
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { background: { gradientTo: '#202020' } },
    });
    expect(state.meta.appearance?.background.type).toBe('gradient');
    expect(state.meta.appearance?.background.gradientFrom).toBe('#101010');
    expect(state.meta.appearance?.background.gradientTo).toBe('#202020');
    // Other appearance groups keep their defaults.
    expect(state.meta.appearance?.colors.primary).toBe(DEFAULT_APPEARANCE.colors.primary);

    const payload = toFormInput(state);
    expect(formInputSchema.safeParse(payload).success).toBe(true);
    const appearance = payload.appearance as { background: { type: string; gradientTo: string } };
    expect(appearance.background.type).toBe('gradient');
    expect(appearance.background.gradientTo).toBe('#202020');
  });

  it('merges the new layout tokens (inputVariant/buttonSize/focusStyle) onto the defaults (§1.2/§1.5/§1.7)', () => {
    let state = loaded();
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { layout: { inputVariant: 'filled' } },
    });
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { layout: { buttonSize: 'lg', focusStyle: 'glow' } },
    });
    expect(state.meta.appearance?.layout.inputVariant).toBe('filled');
    expect(state.meta.appearance?.layout.buttonSize).toBe('lg');
    expect(state.meta.appearance?.layout.focusStyle).toBe('glow');
    // Untouched layout tokens keep today's defaults.
    expect(state.meta.appearance?.layout.requiredMark).toBe('asterisk');
    expect(state.meta.appearance?.layout.radius).toBe(DEFAULT_APPEARANCE.layout.radius);
  });

  it('sets and clears logo/cover without dropping the other tokens', () => {
    let state = loaded();
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { logo: { url: 'https://cdn.example.com/logo.png' } },
    });
    expect(state.meta.appearance?.logo?.url).toBe('https://cdn.example.com/logo.png');

    // A colour edit must not wipe the logo (absent key = leave as-is).
    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { colors: { primary: '#123456' } },
    });
    expect(state.meta.appearance?.logo?.url).toBe('https://cdn.example.com/logo.png');
    expect(state.meta.appearance?.colors.primary).toBe('#123456');

    // An explicit undefined clears it.
    state = builderReducer(state, { type: 'updateAppearance', patch: { logo: undefined } });
    expect(state.meta.appearance?.logo).toBeUndefined();
  });

  it('toFormInput includes appearance only when set, and stays schema-valid', () => {
    let state = loaded();
    state = builderReducer(state, { type: 'addField', fieldType: 'text' });
    expect('appearance' in toFormInput(state)).toBe(false);

    state = builderReducer(state, {
      type: 'updateAppearance',
      patch: { typography: { baseSize: 16 } },
    });
    const payload = toFormInput(state);
    expect((payload.appearance as { typography: { baseSize: number } }).typography.baseSize).toBe(
      16,
    );
    expect(formInputSchema.safeParse(payload).success).toBe(true);
  });
});

describe('slugifyKey', () => {
  it('derives machine-safe keys', () => {
    expect(slugifyKey('Full Name!')).toBe('full_name');
    expect(slugifyKey('  Email address ')).toBe('email_address');
    expect(slugifyKey('123 what')).toBe('what');
    expect(slugifyKey('!!!')).toBe('field');
  });
});
