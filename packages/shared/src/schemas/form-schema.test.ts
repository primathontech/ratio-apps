import { describe, expect, it } from 'vitest';
import {
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_TEXTAREA_DEFAULT_MAX_LENGTH,
  FORM_TEXTAREA_HARD_MAX_LENGTH,
  type FormField,
  formFieldSchema,
  formInputSchema,
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

const allEight = [
  textField,
  textareaField,
  emailField,
  phoneField,
  dropdownField,
  multiSelectField,
  dateField,
  fileField,
];

describe('formFieldSchema (discriminated union over the 8 field types)', () => {
  it.each(
    allEight.map((f) => [f.type, f] as const),
  )('accepts a fully-configured %s field', (_type, field) => {
    const result = formFieldSchema.safeParse(field);
    expect(result.success).toBe(true);
  });

  it('rejects an unknown field type', () => {
    expect(formFieldSchema.safeParse({ key: 'x', type: 'checkbox', label: 'X' }).success).toBe(
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
    expect(parsed.required).toBe(false);
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
});

describe('formInputSchema (form CRUD contract)', () => {
  const validForm = {
    name: 'Contact us',
    schema: allEight,
    submitLabel: 'Send',
    successMessage: 'Thanks — we will get back to you.',
    spamProtection: 'recaptcha',
    notificationEmail: 'leads@merchant.example',
    webhookUrl: 'https://hooks.merchant.example/forms',
  };

  it('accepts a full form with all 8 field types', () => {
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

  it('the inferred FormField type discriminates on `type`', () => {
    const parsed: FormField = formFieldSchema.parse(dropdownField);
    if (parsed.type === 'dropdown') {
      expect(parsed.options).toEqual(['Sales', 'Support']);
    }
  });
});
