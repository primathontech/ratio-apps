import { describe, expect, it } from 'vitest';
import { validateTextarea } from '../../../../src/modules/forms/submissions/fields/textarea/validate';
import type { FieldOfType } from '../../../../src/modules/forms/submissions/fields/types';

const field = (over: Partial<FieldOfType<'textarea'>> = {}): FieldOfType<'textarea'> =>
  ({
    key: 'msg',
    type: 'textarea',
    label: 'Message',
    required: false,
    validation: { maxLength: 10 },
    ...over,
  }) as FieldOfType<'textarea'>;

describe('validateTextarea — server-authoritative length (Batch-4 field depth)', () => {
  it('returns the value unchanged for an in-bounds string', () => {
    expect(validateTextarea(field(), 'hello')).toEqual({ value: 'hello' });
  });

  it('rejects an over-max value even though enforceMaxLength is a client-only hint (bypass)', () => {
    // display.enforceMaxLength only adds a native maxlength in the browser; a
    // crafted POST omits it, so the server must still reject on its own.
    const f = field({ display: { enforceMaxLength: false }, validation: { maxLength: 10 } });
    const res = validateTextarea(f, 'x'.repeat(25));
    expect(res.error).toBeDefined();
    expect(res.value).toBeUndefined();
  });

  it('still rejects over-max when enforceMaxLength is true (attribute is not a security control)', () => {
    const f = field({ display: { enforceMaxLength: true }, validation: { maxLength: 10 } });
    expect(validateTextarea(f, 'x'.repeat(11)).error).toBeDefined();
  });

  it('enforces minLength server-side', () => {
    const f = field({ validation: { minLength: 5, maxLength: 100 } });
    expect(validateTextarea(f, 'abc').error).toBeDefined();
    expect(validateTextarea(f, 'abcdef')).toEqual({ value: 'abcdef' });
  });

  it('rejects a non-string value', () => {
    expect(validateTextarea(field(), 42).error).toBeDefined();
  });
});
