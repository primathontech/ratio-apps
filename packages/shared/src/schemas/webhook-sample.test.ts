import { describe, expect, it } from 'vitest';
import { formSubmittedPayloadSchema } from '../constants/forms-events';
import type { FormField } from './form-schema';
import {
  buildSampleFields,
  buildSamplePayload,
  buildWebhookCurl,
  type SamplePayloadMeta,
  sampleFieldValue,
} from './webhook-sample';

const META: SamplePayloadMeta = {
  merchantId: 'm_1',
  formId: 'form_1',
  formName: 'Contact',
  submissionId: 'sub_test_1',
  submittedAt: '2026-01-01T00:00:00.000Z',
};

// Minimal field literals — sampleFieldValue only reads type/label/key/options/max/paramName.
const f = (partial: Partial<FormField> & { type: FormField['type']; key: string }): FormField =>
  ({ label: `${partial.type} field`, ...partial }) as FormField;

describe('sampleFieldValue — faithful per-type shapes', () => {
  it('emits the option VALUE (not label) for select fields', () => {
    const opts = [
      { value: 'sales', label: 'Sales enquiry' },
      { value: 'support', label: 'Support' },
    ];
    expect(sampleFieldValue(f({ type: 'dropdown', key: 'topic', options: opts }))).toBe('sales');
    expect(sampleFieldValue(f({ type: 'radio', key: 'plan', options: opts }))).toBe('sales');
    expect(sampleFieldValue(f({ type: 'multi_select', key: 'ch', options: opts }))).toEqual([
      'sales',
    ]);
  });

  it('emits native types for number / rating / checkbox', () => {
    expect(sampleFieldValue(f({ type: 'number', key: 'qty' }))).toBe(42);
    expect(sampleFieldValue(f({ type: 'checkbox', key: 'agree' }))).toBe(true);
    const rating = sampleFieldValue({
      type: 'rating',
      key: 'stars',
      label: 'Stars',
      max: 3,
    } as unknown as FormField);
    expect(typeof rating).toBe('number');
    expect(rating).toBeLessThanOrEqual(3);
  });

  it('emits strings for the text-like and captured field types', () => {
    expect(sampleFieldValue(f({ type: 'email', key: 'e' }))).toBe('shopper@example.com');
    expect(sampleFieldValue(f({ type: 'url', key: 'u' }))).toBe('https://example.com');
    expect(sampleFieldValue(f({ type: 'date', key: 'd' }))).toBe('2026-01-01');
    expect(sampleFieldValue(f({ type: 'file', key: 'cv' }))).toMatch(/^https:\/\//);
    expect(sampleFieldValue(f({ type: 'hidden', key: 'utm', paramName: 'utm_source' }))).toBe(
      'sample-utm_source',
    );
    expect(sampleFieldValue(f({ type: 'text', key: 't', label: 'Name' }))).toBe('Sample Name');
  });

  it('emits nothing for content blocks', () => {
    for (const type of ['heading', 'divider', 'paragraph', 'image'] as const) {
      expect(sampleFieldValue(f({ type, key: `c_${type}` }))).toBeUndefined();
    }
  });
});

describe('buildSampleFields / buildSamplePayload', () => {
  const fields: FormField[] = [
    f({ type: 'text', key: 'name', label: 'Name' }),
    f({ type: 'heading', key: 'h1' }),
    f({ type: 'dropdown', key: 'topic', options: [{ value: 'sales', label: 'Sales' }] }),
  ];

  it('keys by field.key and drops content blocks', () => {
    expect(buildSampleFields(fields)).toEqual({ name: 'Sample Name', topic: 'sales' });
  });

  it('produces a payload that passes the real form.submitted schema', () => {
    const payload = buildSamplePayload(fields, META);
    expect(() => formSubmittedPayloadSchema.parse(payload)).not.toThrow();
    expect(payload.event).toBe('form.submitted');
  });

  it('an empty form yields an empty fields object', () => {
    expect(buildSamplePayload([], META).fields).toEqual({});
  });
});

describe('buildWebhookCurl — shell safety', () => {
  it('shows the url, content-type header, and body', () => {
    const curl = buildWebhookCurl('https://hooks.example/forms', buildSamplePayload([], META));
    expect(curl).toContain("curl -X POST 'https://hooks.example/forms'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain('"event": "form.submitted"');
  });

  it("escapes single quotes so a label with an apostrophe can't break out of the shell string", () => {
    const fields: FormField[] = [f({ type: 'text', key: 'name', label: "Rider's name" })];
    const curl = buildWebhookCurl('https://hooks.example/forms', buildSamplePayload(fields, META));
    // The apostrophe becomes the POSIX escape sequence '\'' — never a bare '.
    expect(curl).toContain("'\\''");
    expect(curl).toContain("Sample Rider'\\''s name");
  });
});
