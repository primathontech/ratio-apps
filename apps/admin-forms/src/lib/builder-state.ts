import {
  appearanceSchema,
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  type FormAppearance,
  type FormField,
  type FormFieldType,
} from '@shared/schemas/form-schema';

/**
 * Pure reducer for the form-builder screen (TDD §4 `builder-state`). No React,
 * no IO — unit-testable without simulating pointer drags.
 */

/** Form-level metadata edited in the right panel when no field is selected. */
export interface BuilderMeta {
  name: string;
  submitLabel: string;
  successMessage: string;
  spamProtection: 'recaptcha' | 'honeypot';
  /** Kept as '' when unset — mapped to `undefined` at save time. */
  notificationEmail: string;
  webhookUrl: string;
  /** Form subtitle shown under the title. '' when unset. */
  description: string;
  /** Redirect-on-submit target (https). '' when unset. */
  redirectUrl: string;
  /** Absent = un-themed (SDK renders with its baked-in defaults). */
  appearance?: FormAppearance | undefined;
}

/**
 * Fully-defaulted appearance — every token at today's baked-in SDK value.
 * The merge base for single-token edits and the preview's fallback.
 */
export const DEFAULT_APPEARANCE: FormAppearance = appearanceSchema.parse({});

/** Deep-partial patch for a single Design-tab edit. */
export interface AppearancePatch {
  colors?: Partial<FormAppearance['colors']>;
  typography?: Partial<FormAppearance['typography']>;
  layout?: Partial<FormAppearance['layout']>;
  background?: Partial<FormAppearance['background']>;
  /** Present (incl. `undefined`) = set/clear the logo; absent = leave it. */
  logo?: FormAppearance['logo'];
  cover?: FormAppearance['cover'];
}

export interface BuilderState {
  meta: BuilderMeta;
  fields: FormField[];
  /** Key of the field whose settings are open; null = form settings. */
  selectedKey: string | null;
  /** True once any transition since the last `load`/`markSaved`. */
  dirty: boolean;
}

export type BuilderAction =
  | {
      type: 'load';
      form: {
        name: string;
        schema: FormField[];
        submitLabel: string;
        successMessage: string;
        spamProtection: 'recaptcha' | 'honeypot';
        notificationEmail: string | null;
        webhookUrl: string | null;
        description?: string | null;
        redirectUrl?: string | null;
        appearance?: FormAppearance | undefined;
      };
    }
  | { type: 'addField'; fieldType: FormFieldType; index?: number }
  | { type: 'removeField'; key: string }
  | { type: 'reorderField'; from: number; to: number }
  | { type: 'updateField'; key: string; patch: Partial<FormField> }
  | { type: 'updateMeta'; patch: Partial<BuilderMeta> }
  | { type: 'updateAppearance'; patch: AppearancePatch }
  | { type: 'selectField'; key: string | null }
  | { type: 'markSaved' };

export const EMPTY_BUILDER_STATE: BuilderState = {
  meta: {
    name: '',
    submitLabel: 'Submit',
    successMessage: 'Thank you! Your submission has been received.',
    spamProtection: 'recaptcha',
    notificationEmail: '',
    webhookUrl: '',
    description: '',
    redirectUrl: '',
  },
  fields: [],
  selectedKey: null,
  dirty: false,
};

/** Palette labels — also the default label a freshly-added field gets. */
export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Text',
  textarea: 'Paragraph',
  email: 'Email',
  phone: 'Phone',
  dropdown: 'Dropdown',
  multi_select: 'Multi-select',
  date: 'Date',
  file: 'File upload',
  radio: 'Radio',
  checkbox: 'Checkbox',
  number: 'Number',
  url: 'URL',
  rating: 'Rating',
  hidden: 'Hidden',
  // Content blocks (§1.3) — display-only, no data. 'Text block' keeps the
  // paragraph block distinct from the 'Paragraph' (textarea) input.
  heading: 'Heading',
  divider: 'Divider',
  paragraph: 'Text block',
  image: 'Image',
};

/**
 * Machine-safe field key from a label: `Full Name!` → `full_name`. Must
 * satisfy `formFieldKeySchema` (start with a letter; letters/digits/_ only).
 */
export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, 64);
  return slug || 'field';
}

function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base.slice(0, 60)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A fresh field of the given type with type-appropriate default validation. */
export function makeField(fieldType: FormFieldType, existing: readonly FormField[]): FormField {
  const taken = new Set(existing.map((f) => f.key));
  const label = FIELD_TYPE_LABELS[fieldType];
  const key = uniqueKey(slugifyKey(label), taken);
  // Content blocks (§1.3) carry only key + width — no label/required. The
  // image block needs a schema-valid https url up front, so it seeds a
  // placeholder the merchant replaces in the property panel.
  switch (fieldType) {
    case 'heading':
      return { key, type: 'heading', text: 'Section heading', level: 'h2', width: 'full' };
    case 'divider':
      return { key, type: 'divider', width: 'full' };
    case 'paragraph':
      return { key, type: 'paragraph', text: 'Add a short description here.', width: 'full' };
    case 'image':
      return { key, type: 'image', url: 'https://cdn.example.com/image.png', width: 'full' };
  }
  // showCounter carries a schema default (false), so it is a required output
  // key on every collectable field type — seed it here (§2.3).
  const base = { key, label, required: false, width: 'full' as const, showCounter: false };
  switch (fieldType) {
    case 'text':
      return { ...base, type: 'text' };
    case 'textarea':
      return {
        ...base,
        type: 'textarea',
        validation: { maxLength: FORM_TEXTAREA_DEFAULT_MAX_LENGTH },
      };
    case 'email':
      return { ...base, type: 'email' };
    case 'phone':
      return { ...base, type: 'phone' };
    case 'dropdown':
      return { ...base, type: 'dropdown', options: ['Option 1'] };
    case 'multi_select':
      return { ...base, type: 'multi_select', options: ['Option 1'] };
    case 'date':
      return { ...base, type: 'date' };
    case 'file':
      return {
        ...base,
        type: 'file',
        validation: {
          allowedMimeTypes: [...FORM_FILE_ALLOWED_MIME_TYPES],
          maxBytes: FORM_FILE_MAX_BYTES,
        },
      };
    case 'radio':
      return { ...base, type: 'radio', options: ['Option 1'] };
    case 'checkbox':
      return { ...base, type: 'checkbox' };
    case 'number':
      return { ...base, type: 'number' };
    case 'url':
      return { ...base, type: 'url' };
    case 'rating':
      return { ...base, type: 'rating', max: 5, icon: 'star' };
    case 'hidden':
      // paramName defaults to the field key; both are machine-safe strings.
      return { ...base, type: 'hidden', paramName: key };
  }
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'load':
      return {
        meta: {
          name: action.form.name,
          submitLabel: action.form.submitLabel,
          successMessage: action.form.successMessage,
          spamProtection: action.form.spamProtection,
          notificationEmail: action.form.notificationEmail ?? '',
          webhookUrl: action.form.webhookUrl ?? '',
          description: action.form.description ?? '',
          redirectUrl: action.form.redirectUrl ?? '',
          appearance: action.form.appearance,
        },
        fields: action.form.schema,
        selectedKey: null,
        dirty: false,
      };

    case 'addField': {
      const field = makeField(action.fieldType, state.fields);
      const at = clampIndex(action.index ?? state.fields.length, state.fields.length);
      const fields = [...state.fields.slice(0, at), field, ...state.fields.slice(at)];
      return { ...state, fields, selectedKey: field.key, dirty: true };
    }

    case 'removeField': {
      const fields = state.fields.filter((f) => f.key !== action.key);
      if (fields.length === state.fields.length) return state;
      return {
        ...state,
        fields,
        selectedKey: state.selectedKey === action.key ? null : state.selectedKey,
        dirty: true,
      };
    }

    case 'reorderField': {
      const { from, to } = action;
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= state.fields.length ||
        to >= state.fields.length
      ) {
        return state;
      }
      const fields = [...state.fields];
      const [moved] = fields.splice(from, 1);
      if (!moved) return state;
      fields.splice(to, 0, moved);
      return { ...state, fields, dirty: true };
    }

    case 'updateField': {
      const index = state.fields.findIndex((f) => f.key === action.key);
      if (index === -1) return state;
      const current = state.fields[index] as FormField;

      const patch = { ...action.patch };
      // `label` is absent on content-block members, so read it off a narrowed view.
      const patchLabel = (patch as { label?: string }).label;
      // Auto-slug: while the key still mirrors the label (never hand-edited),
      // editing the label re-derives the key. A manually set key sticks.
      if (
        typeof patchLabel === 'string' &&
        patch.key === undefined &&
        'label' in current &&
        current.key === slugifyKey(current.label)
      ) {
        const taken = new Set(state.fields.filter((_, i) => i !== index).map((f) => f.key));
        patch.key = uniqueKey(slugifyKey(patchLabel), taken);
      }

      // Duplicate-key prevention: renaming onto another field's key is a no-op.
      if (
        typeof patch.key === 'string' &&
        patch.key !== current.key &&
        state.fields.some((f, i) => i !== index && f.key === patch.key)
      ) {
        return state;
      }

      const updated = { ...current, ...patch } as FormField;
      const fields = [...state.fields];
      fields[index] = updated;
      return {
        ...state,
        fields,
        selectedKey: state.selectedKey === action.key ? updated.key : state.selectedKey,
        dirty: true,
      };
    }

    case 'updateMeta':
      return { ...state, meta: { ...state.meta, ...action.patch }, dirty: true };

    case 'updateAppearance': {
      // Deep-merge onto the full default so a single-token edit never drops
      // the other tokens from the stored object.
      const base = state.meta.appearance ?? DEFAULT_APPEARANCE;
      const { patch } = action;
      const appearance: FormAppearance = {
        colors: { ...base.colors, ...patch.colors },
        typography: { ...base.typography, ...patch.typography },
        layout: { ...base.layout, ...patch.layout },
        background: { ...base.background, ...patch.background },
        // logo/cover are set/cleared wholesale; an absent key leaves them as-is.
        logo: 'logo' in patch ? patch.logo : base.logo,
        cover: 'cover' in patch ? patch.cover : base.cover,
      };
      return { ...state, meta: { ...state.meta, appearance }, dirty: true };
    }

    case 'selectField':
      if (action.key !== null && !state.fields.some((f) => f.key === action.key)) return state;
      return { ...state, selectedKey: action.key };

    case 'markSaved':
      return { ...state, dirty: false };
  }
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/** The PUT /api/forms/:id payload from the current builder state. */
export function toFormInput(state: BuilderState): Record<string, unknown> {
  const email = state.meta.notificationEmail.trim();
  const webhook = state.meta.webhookUrl.trim();
  const description = state.meta.description.trim();
  const redirect = state.meta.redirectUrl.trim();
  return {
    name: state.meta.name,
    schema: state.fields,
    submitLabel: state.meta.submitLabel,
    successMessage: state.meta.successMessage,
    spamProtection: state.meta.spamProtection,
    ...(email ? { notificationEmail: email } : {}),
    ...(webhook ? { webhookUrl: webhook } : {}),
    ...(description ? { description } : {}),
    ...(redirect ? { redirectUrl: redirect } : {}),
    ...(state.meta.appearance ? { appearance: state.meta.appearance } : {}),
  };
}
