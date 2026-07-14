import {
  FORM_FIELD_TYPES,
  type FormField,
  formFieldsSchema,
  formInputSchema,
} from '@shared/schemas/form-schema';
import { describe, expect, it } from 'vitest';
import {
  type BuilderState,
  builderReducer,
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
  it('adds a field of every one of the 8 types with schema-valid defaults', () => {
    let state = loaded();
    for (const fieldType of FORM_FIELD_TYPES) {
      state = builderReducer(state, { type: 'addField', fieldType });
    }
    expect(state.fields).toHaveLength(8);
    expect(state.fields.map((f) => f.type)).toEqual([...FORM_FIELD_TYPES]);
    // Every freshly-added field must already satisfy the shared schema.
    const parsed = formFieldsSchema.safeParse(state.fields);
    expect(parsed.success).toBe(true);
    expect(state.dirty).toBe(true);
    // The newest field is auto-selected for the settings panel.
    expect(state.selectedKey).toBe(state.fields[7]?.key);
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
});

describe('slugifyKey', () => {
  it('derives machine-safe keys', () => {
    expect(slugifyKey('Full Name!')).toBe('full_name');
    expect(slugifyKey('  Email address ')).toBe('email_address');
    expect(slugifyKey('123 what')).toBe('what');
    expect(slugifyKey('!!!')).toBe('field');
  });
});
