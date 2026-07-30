import { describe, expect, it } from 'vitest';
import {
  FORM_FIELD_TYPES,
  FORM_NON_COLLECTABLE_FIELD_TYPES,
  formFieldsSchema,
  isCollectableFieldType,
} from '../../form-schema';
import { FORM_PAGE_BREAK_TITLE_MAX_LENGTH, pageBreakFieldSchema } from './schema';

const base = { key: 'break1', type: 'page_break' as const };

describe('pageBreakFieldSchema (§steps)', () => {
  it('accepts a bare page_break (key + type only — no value, no label)', () => {
    expect(pageBreakFieldSchema.safeParse(base).success).toBe(true);
  });

  it('accepts an optional step title', () => {
    expect(pageBreakFieldSchema.safeParse({ ...base, title: 'Your details' }).success).toBe(true);
  });

  it('rejects an over-long title', () => {
    const long = 'x'.repeat(FORM_PAGE_BREAK_TITLE_MAX_LENGTH + 1);
    expect(pageBreakFieldSchema.safeParse({ ...base, title: long }).success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(pageBreakFieldSchema.safeParse({ ...base, title: '' }).success).toBe(false);
  });

  it('rejects a submitted value / label — it is a display-only block', () => {
    // `label` and `required` belong to input fields; the content-block base
    // shape only carries key + width, and the object is not `.passthrough()`,
    // so a stray `label` is stripped rather than making it an input. The parse
    // still succeeds (extra keys ignored) but no label survives.
    const parsed = pageBreakFieldSchema.safeParse({ ...base, label: 'nope', required: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('label' in parsed.data).toBe(false);
      expect('required' in parsed.data).toBe(false);
    }
  });
});

describe('page_break as a display-only field type', () => {
  it('is registered as a known field type', () => {
    expect((FORM_FIELD_TYPES as readonly string[]).includes('page_break')).toBe(true);
  });

  it('is non-collectable (stripped from submissions like divider)', () => {
    expect((FORM_NON_COLLECTABLE_FIELD_TYPES as readonly string[]).includes('page_break')).toBe(
      true,
    );
    expect(isCollectableFieldType('page_break')).toBe(false);
  });

  it('parses inside a form via the discriminated union', () => {
    const parsed = formFieldsSchema.safeParse([
      { key: 'name', type: 'text', label: 'Name', required: true },
      { key: 'pb', type: 'page_break', title: 'Step two' },
      { key: 'note', type: 'textarea', label: 'Note' },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('honors the shared key-uniqueness check (its key participates like any field)', () => {
    const parsed = formFieldsSchema.safeParse([
      { key: 'dup', type: 'text', label: 'Name' },
      { key: 'dup', type: 'page_break' },
    ]);
    expect(parsed.success).toBe(false);
  });
});
