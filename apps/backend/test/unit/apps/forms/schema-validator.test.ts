import type { FormField } from '@ratio-app/shared/schemas/form-schema';
import { describe, expect, it } from 'vitest';
import { SchemaValidatorService } from '../../../../src/modules/forms/submissions/schema-validator.service';
import { KITCHEN_SINK_FIELDS, MERCHANT_ID, OTHER_MERCHANT_ID } from './fixtures/forms';
import {
  INVALID_MATRIX,
  VALID_KITCHEN_SINK_FIELDS,
  VALID_KITCHEN_SINK_FILES,
} from './fixtures/submissions';

const FORM_ID = 'form_sink';
const scope = { merchantId: MERCHANT_ID, formId: FORM_ID };
const service = new SchemaValidatorService();

const validate = (
  fields: Record<string, unknown>,
  files?: Record<string, string>,
  schema: FormField[] = KITCHEN_SINK_FIELDS,
) => service.validate(schema, fields, files, scope);

describe('SchemaValidatorService (AC6/F4–F6, F11, F13)', () => {
  it('accepts the kitchen-sink valid payload and normalizes the phone to +91…', () => {
    const result = validate(
      VALID_KITCHEN_SINK_FIELDS,
      VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.phone).toBe('+919876543210');
    expect(result.data.name).toBe('Asha Rao');
    expect(result.data.channels).toEqual(['email', 'sms']);
    expect(result.files).toEqual({ resume: `${MERCHANT_ID}/${FORM_ID}/draft_abc/resume` });
  });

  it('accepts a +91-prefixed phone and normalizes formatting characters', () => {
    const result = validate(
      { ...VALID_KITCHEN_SINK_FIELDS, phone: '+91 98765-43210' },
      VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.phone).toBe('+919876543210');
  });

  it.each(INVALID_MATRIX)('rejects: %s', (_description, overrides, failingKey) => {
    const result = validate(
      { ...VALID_KITCHEN_SINK_FIELDS, ...overrides },
      VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toContain(failingKey);
  });

  it('rejects a missing required file (F11)', () => {
    const result = validate(VALID_KITCHEN_SINK_FIELDS, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.resume).toBeDefined();
  });

  it("rejects an S3 key outside this merchant+form's prefix (cross-tenant guard, TDD §3.6)", () => {
    for (const badKey of [
      `${OTHER_MERCHANT_ID}/${FORM_ID}/draft_abc/resume`,
      `${MERCHANT_ID}/form_other/draft_abc/resume`,
      '../../etc/passwd',
    ]) {
      const result = validate(VALID_KITCHEN_SINK_FIELDS, { resume: badKey });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.resume).toBeDefined();
    }
  });

  it('rejects unknown field keys (no mass-assignment)', () => {
    const result = validate(
      { ...VALID_KITCHEN_SINK_FIELDS, injected: 'x' },
      VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.injected).toBe('unknown field');
  });

  it('rejects unknown file-field keys and files targeting non-file fields', () => {
    const result = validate(VALID_KITCHEN_SINK_FIELDS, {
      ...VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
      name: `${MERCHANT_ID}/${FORM_ID}/draft_abc/name`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBe('unknown file field');
  });

  it('skips empty optional fields without error (and excludes them from data)', () => {
    const result = validate(
      { ...VALID_KITCHEN_SINK_FIELDS, bio: '', channels: [], visit_date: undefined },
      VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('bio' in result.data).toBe(false);
    expect('channels' in result.data).toBe(false);
  });

  it('applies the 5,000 textarea default when the field has no explicit max (F13)', () => {
    const schema: FormField[] = [
      { key: 'notes', type: 'textarea', label: 'Notes', required: false } as FormField,
    ];
    const okay = service.validate(schema, { notes: 'x'.repeat(5000) }, undefined, scope);
    expect(okay.ok).toBe(true);
    const over = service.validate(schema, { notes: 'x'.repeat(5001) }, undefined, scope);
    expect(over.ok).toBe(false);
  });

  it('collects errors per field (422 detail payload upstream)', () => {
    const result = validate(
      { ...VALID_KITCHEN_SINK_FIELDS, email: 'nope', phone: '12' },
      VALID_KITCHEN_SINK_FILES(MERCHANT_ID, FORM_ID),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.email).toBeDefined();
      expect(result.errors.phone).toBeDefined();
    }
  });
});
