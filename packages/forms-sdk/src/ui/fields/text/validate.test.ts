import { describe, expect, it } from 'vitest';
import type { ControlFieldOf, FieldValidateCtx } from '../types';
import { validateText } from './validate';

const field = (validation?: Record<string, unknown>, required = false): ControlFieldOf<'text'> =>
  ({
    key: 'name',
    type: 'text',
    label: 'Name',
    required,
    ...(validation ? { validation } : {}),
  }) as ControlFieldOf<'text'>;
const ctx = (value: unknown): FieldValidateCtx => ({ values: { name: value }, files: {} });

// Client parity for the server-authoritative text validator: the widget must
// mirror the server verdict using the same shared constants.
describe('validateText (client parity, Batch-4 field depth)', () => {
  it('honors required vs optional on an empty value', () => {
    expect(validateText(field(undefined, true), ctx(''))).toBe('This field is required.');
    expect(validateText(field(undefined, false), ctx(''))).toBeNull();
  });

  it('mirrors the transform before the length check', () => {
    // 'ok' after trim_upper is 2 chars → passes maxLength 2.
    expect(
      validateText(field({ transform: 'trim_upper', maxLength: 2 }), ctx('  ok  ')),
    ).toBeNull();
  });

  it('mirrors the hard-ceiling cap on maxLength', () => {
    expect(validateText(field({ transform: 'none', maxLength: 5000 }), ctx('a'.repeat(1001)))).toBe(
      'Please enter no more than 1000 characters.',
    );
  });

  it('mirrors a format preset and surfaces patternMessage', () => {
    const f = field({ format: 'pan', transform: 'none', patternMessage: 'Bad PAN' });
    expect(validateText(f, ctx('ABCDE1234F'))).toBeNull();
    expect(validateText(f, ctx('nope'))).toBe('Bad PAN');
  });

  it('mirrors a custom regex', () => {
    const f = field({ pattern: '^[a-z]+$', transform: 'none' });
    expect(validateText(f, ctx('abc'))).toBeNull();
    expect(validateText(f, ctx('abc1'))).not.toBeNull();
  });

  it('mirrors minLength against the transformed value', () => {
    const f = field({ transform: 'trim', minLength: 3 });
    expect(validateText(f, ctx('  ab  '))).not.toBeNull();
    expect(validateText(f, ctx('  abc  '))).toBeNull();
  });
});
