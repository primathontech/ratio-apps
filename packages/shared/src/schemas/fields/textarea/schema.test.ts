import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { textareaDisplaySchema, textareaFieldSchema } from './schema';

const baseField = {
  key: 'msg',
  type: 'textarea' as const,
  label: 'Message',
  required: false,
};

describe('textareaFieldSchema — Batch-4 display enrichments', () => {
  it('stays valid with no display object (existing forms unchanged)', () => {
    const parsed = textareaFieldSchema.parse(baseField);
    expect(parsed.display).toBeUndefined();
    // Union member must remain a plain ZodObject (not a refinement wrapper) so
    // the discriminated union keeps working.
    expect(textareaFieldSchema instanceof z.ZodObject).toBe(true);
  });

  it('accepts a fully-specified display object', () => {
    const parsed = textareaFieldSchema.parse({
      ...baseField,
      display: {
        minRows: 4,
        maxRows: 12,
        autoGrow: true,
        enforceMaxLength: true,
        counterUnit: 'words',
        monospace: true,
      },
    });
    expect(parsed.display?.counterUnit).toBe('words');
    expect(parsed.display?.autoGrow).toBe(true);
  });

  it('rejects minRows greater than maxRows (self-refine)', () => {
    expect(textareaDisplaySchema.safeParse({ minRows: 10, maxRows: 4 }).success).toBe(false);
  });

  it('bounds row counts and rejects an unknown counter unit', () => {
    expect(textareaDisplaySchema.safeParse({ minRows: 0 }).success).toBe(false);
    expect(textareaDisplaySchema.safeParse({ maxRows: 999 }).success).toBe(false);
    expect(textareaDisplaySchema.safeParse({ counterUnit: 'sentences' }).success).toBe(false);
  });
});
