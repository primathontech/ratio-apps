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

describe('SchemaValidatorService — new P0 field types (radio / checkbox / number, §4)', () => {
  const run = (schema: FormField[], fields: Record<string, unknown>) =>
    service.validate(schema, fields, undefined, scope);

  describe('radio', () => {
    const schema: FormField[] = [
      { key: 'plan', type: 'radio', label: 'Plan', required: true, options: ['basic', 'pro'] },
    ];

    it('accepts a configured option', () => {
      const result = run(schema, { plan: 'pro' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.plan).toBe('pro');
    });

    it('rejects a value outside the options', () => {
      const result = run(schema, { plan: 'enterprise' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.plan).toBeDefined();
    });

    it('rejects a missing required selection', () => {
      const result = run(schema, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.plan).toBe('this field is required');
    });
  });

  describe('checkbox (single consent)', () => {
    const required: FormField[] = [
      { key: 'consent', type: 'checkbox', label: 'I agree', required: true },
    ];
    const optional: FormField[] = [
      { key: 'news', type: 'checkbox', label: 'Subscribe', required: false },
    ];

    it('accepts a ticked required box (true)', () => {
      const result = run(required, { consent: true });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.consent).toBe(true);
    });

    it('rejects an unticked required box (false)', () => {
      const result = run(required, { consent: false });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.consent).toBe('this field is required');
    });

    it('rejects a non-boolean value', () => {
      const result = run(required, { consent: 'yes' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.consent).toBe('must be a boolean');
    });

    it('accepts an unticked optional box and keeps the false value', () => {
      const result = run(optional, { news: false });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.news).toBe(false);
    });
  });

  describe('number', () => {
    const schema: FormField[] = [
      {
        key: 'qty',
        type: 'number',
        label: 'Quantity',
        required: true,
        validation: { min: 1, max: 10, integer: true },
      },
    ];

    it('accepts an in-range integer and stores it as a number', () => {
      const result = run(schema, { qty: 5 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.qty).toBe(5);
    });

    it('coerces a numeric string to a number', () => {
      const result = run(schema, { qty: '7' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.qty).toBe(7);
    });

    it('rejects a non-numeric value', () => {
      const result = run(schema, { qty: 'abc' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.qty).toBe('must be a number');
    });

    it('rejects a decimal when integer is required', () => {
      const result = run(schema, { qty: 2.5 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.qty).toBe('must be a whole number');
    });

    it('enforces min and max bounds', () => {
      expect(run(schema, { qty: 0 }).ok).toBe(false);
      expect(run(schema, { qty: 11 }).ok).toBe(false);
    });

    it('accepts 0 for an optional number without a min (not treated as empty)', () => {
      const optional: FormField[] = [
        { key: 'count', type: 'number', label: 'Count', required: false },
      ];
      const result = run(optional, { count: 0 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.count).toBe(0);
    });
  });
});

describe('SchemaValidatorService — P1 field types (url / rating / hidden, §4)', () => {
  const run = (schema: FormField[], fields: Record<string, unknown>) =>
    service.validate(schema, fields, undefined, scope);

  describe('url', () => {
    const schema: FormField[] = [{ key: 'site', type: 'url', label: 'Website', required: true }];

    it('accepts an https URL', () => {
      const result = run(schema, { site: 'https://example.com/path?q=1' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.site).toBe('https://example.com/path?q=1');
    });

    it('accepts an http URL', () => {
      expect(run(schema, { site: 'http://example.com' }).ok).toBe(true);
    });

    it('rejects a non-url string', () => {
      const result = run(schema, { site: 'not a url' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.site).toBe('must be a valid URL');
    });

    it('rejects a non-http(s) scheme', () => {
      const result = run(schema, { site: 'javascript:alert(1)' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.site).toBe('must be a valid http or https URL');
    });

    it('rejects a non-string value', () => {
      const result = run(schema, { site: 42 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.site).toBe('must be a string');
    });

    it('skips an empty optional url without error', () => {
      const optional: FormField[] = [
        { key: 'site', type: 'url', label: 'Website', required: false },
      ];
      const result = run(optional, { site: '' });
      expect(result.ok).toBe(true);
      if (result.ok) expect('site' in result.data).toBe(false);
    });
  });

  describe('rating', () => {
    const schema: FormField[] = [
      { key: 'score', type: 'rating', label: 'Rate us', required: true, max: 5, icon: 'star' },
    ];

    it('accepts an integer within 1..max', () => {
      const result = run(schema, { score: 4 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.score).toBe(4);
    });

    it('coerces a numeric string to a number', () => {
      const result = run(schema, { score: '3' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.score).toBe(3);
    });

    it('rejects 0 (below the 1 floor)', () => {
      const result = run(schema, { score: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.score).toBe('must be between 1 and 5');
    });

    it('rejects a value above max', () => {
      const result = run(schema, { score: 6 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.score).toBe('must be between 1 and 5');
    });

    it('rejects a non-integer', () => {
      const result = run(schema, { score: 3.5 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.score).toBe('must be a whole number');
    });

    it('honors a custom max', () => {
      const wide: FormField[] = [
        { key: 'score', type: 'rating', label: 'Rate', required: true, max: 10, icon: 'heart' },
      ];
      expect(run(wide, { score: 10 }).ok).toBe(true);
      expect(run(wide, { score: 11 }).ok).toBe(false);
    });
  });

  describe('content blocks (heading / divider / paragraph / image — non-collectable, §1.3)', () => {
    // A form mixing display-only blocks with two real collectable fields.
    const schema: FormField[] = [
      { key: 'section', type: 'heading', label: '', text: 'About you', level: 'h2', width: 'full' },
      { key: 'name', type: 'text', label: 'Name', required: true },
      { key: 'rule', type: 'divider', width: 'full' },
      { key: 'note', type: 'paragraph', text: 'We never share your data.', width: 'full' },
      {
        key: 'banner',
        type: 'image',
        url: 'https://assets.example.com/banner.png',
        alt: 'banner',
        width: 'full',
      },
      { key: 'email', type: 'email', label: 'Email', required: false },
    ] as FormField[];

    it('validates a submission and stores only the collectable fields', () => {
      const result = service.validate(
        schema,
        { name: 'Asha Rao', email: 'asha@example.com' },
        undefined,
        scope,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ name: 'Asha Rao', email: 'asha@example.com' });
      // No content-block key leaks into data_json.
      for (const key of ['section', 'rule', 'note', 'banner']) {
        expect(key in result.data).toBe(false);
      }
    });

    it('never treats a content block as required (empty submission still fails only on real fields)', () => {
      const result = service.validate(schema, {}, undefined, scope);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Only the required text field errors; blocks are silent.
      expect(result.errors.name).toBe('this field is required');
      for (const key of ['section', 'rule', 'note', 'banner']) {
        expect(key in result.errors).toBe(false);
      }
    });

    it('silently drops a stray value submitted against a content-block key', () => {
      const result = service.validate(
        schema,
        { name: 'Asha Rao', section: 'injected', note: 'x' },
        undefined,
        scope,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('section' in result.data).toBe(false);
      expect('note' in result.data).toBe(false);
    });
  });

  describe('hidden', () => {
    const schema: FormField[] = [
      {
        key: 'utm_source',
        type: 'hidden',
        label: 'UTM source',
        required: false,
        paramName: 'utm_source',
      },
    ];

    it('accepts a captured string value', () => {
      const result = run(schema, { utm_source: 'newsletter' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.utm_source).toBe('newsletter');
    });

    it('skips an absent optional hidden value', () => {
      const result = run(schema, {});
      expect(result.ok).toBe(true);
      if (result.ok) expect('utm_source' in result.data).toBe(false);
    });

    it('rejects a non-string value', () => {
      const result = run(schema, { utm_source: { nested: true } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.utm_source).toBe('must be a string');
    });

    it('rejects an over-long captured value (DoS guard)', () => {
      const result = run(schema, { utm_source: 'x'.repeat(2049) });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.utm_source).toBeDefined();
    });

    it('enforces required when the param is absent', () => {
      const required: FormField[] = [
        { key: 'ref', type: 'hidden', label: 'Ref', required: true, paramName: 'ref' },
      ];
      const result = run(required, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.ref).toBe('this field is required');
    });
  });
});
