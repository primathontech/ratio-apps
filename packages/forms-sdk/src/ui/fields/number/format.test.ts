import { describe, expect, it } from 'vitest';
import type { ControlFieldOf } from '../types';
import { canonicalizeNumber, numericValue } from './format';

type Fmt = ControlFieldOf<'number'>['format'];
const fmt = (over: Record<string, unknown> = {}): Fmt =>
  ({ style: 'decimal', currency: 'INR', locale: 'en-US', grouping: true, ...over }) as Fmt;

describe('canonicalizeNumber (Batch-4 blur canonicalization)', () => {
  it('strips locale grouping separators to a plain ASCII number', () => {
    expect(canonicalizeNumber('1,234', fmt())).toBe('1234');
    expect(canonicalizeNumber('1,234,567', fmt())).toBe('1234567');
  });

  it('rounds to decimalPlaces so display==submit (e.g. $1,235)', () => {
    expect(canonicalizeNumber('1234.56', fmt({ style: 'currency', decimalPlaces: 0 }))).toBe(
      '1235',
    );
    expect(canonicalizeNumber('1.005', fmt({ decimalPlaces: 2 }))).toBe('1'); // toFixed rounding
  });

  it('normalizes a locale decimal separator (de-DE uses ",") to "."', () => {
    // de-DE: grouping "." + decimal ","  → "1.234,5" is 1234.5
    expect(canonicalizeNumber('1.234,5', fmt({ locale: 'de-DE' }))).toBe('1234.5');
  });

  it('drops whitespace grouping (fr-FR narrow no-break space)', () => {
    expect(canonicalizeNumber('12 345', fmt({ locale: 'fr-FR' }))).toBe('12345');
  });

  it('passes an already-canonical value through unchanged', () => {
    expect(canonicalizeNumber('42', fmt())).toBe('42');
    expect(canonicalizeNumber('', fmt())).toBe('');
  });

  it('leaves un-parseable text as-is for the validator to reject', () => {
    expect(canonicalizeNumber('abc', fmt())).toBe('abc');
  });
});

describe('numericValue (tolerant validator parse)', () => {
  it('parses a grouped value instead of NaN-ing', () => {
    expect(numericValue('1,234', fmt())).toBe(1234);
  });
  it('yields NaN for non-numeric input', () => {
    expect(Number.isNaN(numericValue('abc', fmt()))).toBe(true);
  });
});
