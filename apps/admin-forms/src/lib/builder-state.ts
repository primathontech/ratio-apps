import {
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
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
      };
    }
  | { type: 'addField'; fieldType: FormFieldType; index?: number }
  | { type: 'removeField'; key: string }
  | { type: 'reorderField'; from: number; to: number }
  | { type: 'updateField'; key: string; patch: Partial<FormField> }
  | { type: 'updateMeta'; patch: Partial<BuilderMeta> }
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
  const base = { key, label, required: false };
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
      // Auto-slug: while the key still mirrors the label (never hand-edited),
      // editing the label re-derives the key. A manually set key sticks.
      if (
        typeof patch.label === 'string' &&
        patch.key === undefined &&
        current.key === slugifyKey(current.label)
      ) {
        const taken = new Set(state.fields.filter((_, i) => i !== index).map((f) => f.key));
        patch.key = uniqueKey(slugifyKey(patch.label), taken);
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
  return {
    name: state.meta.name,
    schema: state.fields,
    submitLabel: state.meta.submitLabel,
    successMessage: state.meta.successMessage,
    spamProtection: state.meta.spamProtection,
    ...(email ? { notificationEmail: email } : {}),
    ...(webhook ? { webhookUrl: webhook } : {}),
  };
}
