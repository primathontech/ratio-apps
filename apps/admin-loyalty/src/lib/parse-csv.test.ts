import { describe, expect, it } from 'vitest';
import { parseBulkCsv, splitCsvLine, toCsv } from './parse-csv';

describe('splitCsvLine', () => {
  it('splits plain comma-separated fields', () => {
    expect(splitCsvLine('9876543210,100,Diwali bonus')).toEqual([
      '9876543210',
      '100',
      'Diwali bonus',
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(splitCsvLine('"98765 43210",100,"holiday, bonus"')).toEqual([
      '98765 43210',
      '100',
      'holiday, bonus',
    ]);
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    expect(splitCsvLine('9876543210,50,"said ""thanks"""')).toEqual([
      '9876543210',
      '50',
      'said "thanks"',
    ]);
  });

  it('returns empty strings for missing fields', () => {
    expect(splitCsvLine('9876543210,')).toEqual(['9876543210', '']);
  });
});

describe('parseBulkCsv', () => {
  it('parses valid rows, skipping the header row', () => {
    const result = parseBulkCsv(
      'phone_number,amount,reason\n9876543210,100,Diwali\n9876500000,50\n',
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ rowNumber: 1, phone: '9876543210', points: 100 });
    expect(result.rows[0]?.reason).toBe('Diwali');
    expect(result.rows[1]?.reason).toBeUndefined();
    expect(result.invalid).toHaveLength(0);
    expect(result.totalPoints).toBe(150);
  });

  it('works without a header row', () => {
    const result = parseBulkCsv('9876543210,100\n9876500000,50');
    expect(result.rows).toHaveLength(2);
    expect(result.totalPoints).toBe(150);
  });

  it('flags bad rows with reasons', () => {
    const result = parseBulkCsv(
      [
        'phone_number,amount,reason',
        '12345,100,too short phone', // invalid phone
        '9876543210,abc,not a number', // invalid amount
        '9876543211,0,zero points', // below minimum
        '9876543212,-5,negative', // negative
        '9876543213,10.5,fractional', // non-integer
        '', // blank — ignored entirely
        '9876543214,200000,too many', // above 100k cap
        'onlyonefield', // missing amount
      ].join('\n'),
    );
    expect(result.rows).toHaveLength(0);
    expect(result.invalid).toHaveLength(7);
    expect(result.invalid.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.invalid[0]?.error).toMatch(/phone/i);
    expect(result.invalid[1]?.error).toMatch(/whole number/i);
  });

  it('accepts E.164 and spaced/dashed phone formats', () => {
    const result = parseBulkCsv('+919876543210,10\n"98765-43210",20\n"98765 43210",30');
    expect(result.rows.map((r) => r.phone)).toEqual(['+919876543210', '9876543210', '9876543210']);
  });

  it('counts duplicate phones and totals last-wins', () => {
    const result = parseBulkCsv('9876543210,100\n9876500000,10\n9876543210,25');
    // All rows are still shipped to the server (it applies last-wins), but the
    // preview totals must reflect the outcome: 25 + 10.
    expect(result.rows).toHaveLength(3);
    expect(result.duplicateCount).toBe(1);
    expect(result.totalPoints).toBe(35);
    expect(result.uniquePhones).toBe(2);
  });
});

describe('toCsv', () => {
  it('quotes fields containing commas or quotes', () => {
    expect(
      toCsv([
        ['row', 'error'],
        ['1', 'bad, value with "quotes"'],
      ]),
    ).toBe('row,error\n1,"bad, value with ""quotes"""');
  });
});
