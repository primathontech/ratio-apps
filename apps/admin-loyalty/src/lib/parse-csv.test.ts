import { describe, expect, it } from 'vitest';
import {
  BULK_CSV_TEMPLATE,
  detectDelimiter,
  mapHeader,
  normalizeBulkPhone,
  parseAmount,
  parseBulkCsv,
  splitCsvLine,
  toCsv,
} from './parse-csv';

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

  it('splits on an alternate delimiter', () => {
    expect(splitCsvLine('9876543210;100;bonus', ';')).toEqual(['9876543210', '100', 'bonus']);
  });
});

describe('normalizeBulkPhone', () => {
  it('normalizes every accepted Indian format to E.164', () => {
    for (const raw of [
      '9876543210',
      '09876543210',
      '919876543210',
      '+919876543210',
      '+91 98765-43210',
      '(98765) 43210',
    ]) {
      expect(normalizeBulkPhone(raw)).toBe('+919876543210');
    }
  });

  it('rejects non-Indian-mobile shapes the server would also reject', () => {
    // These all passed the OLD client regex and then failed server-side, so the
    // preview promised rows that could never be credited.
    for (const raw of ['1234567890', '5876543210', '12345', '98765432101234', 'abcdefghij', '']) {
      expect(normalizeBulkPhone(raw)).toBeNull();
    }
  });
});

describe('detectDelimiter', () => {
  it('detects semicolons (Excel European locale)', () => {
    expect(detectDelimiter(['phone_number;amount;reason', '9876543210;100;bonus'])).toBe(';');
  });

  it('detects tabs', () => {
    expect(detectDelimiter(['9876543210\t100\tbonus'])).toBe('\t');
  });

  it('ignores separators inside quoted fields', () => {
    // One real `;` separator vs. two commas that live inside quotes.
    expect(detectDelimiter(['"a, b, c";100'])).toBe(';');
  });

  it('falls back to a comma when nothing separates anything', () => {
    expect(detectDelimiter(['9876543210'])).toBe(',');
  });
});

describe('parseAmount', () => {
  it('accepts plain integers', () => {
    expect(parseAmount('100')).toBe(100);
  });

  it('strips thousand separators and currency symbols Excel adds', () => {
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount('₹500')).toBe(500);
    expect(parseAmount('1 500')).toBe(1500);
  });

  it('drops trailing zero decimals but keeps real fractions fractional', () => {
    expect(parseAmount('500.00')).toBe(500);
    expect(parseAmount('10.5')).toBe(10.5);
  });

  it('returns null for non-numeric cells', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('mapHeader', () => {
  it('maps columns by name regardless of order or styling', () => {
    expect(mapHeader(['Amount', 'Phone Number', 'Notes'])).toEqual({
      phone: 1,
      points: 0,
      reason: 2,
    });
  });

  it('returns null for a data row so it is never swallowed as a header', () => {
    expect(mapHeader(['9876543210', '100', 'bonus'])).toBeNull();
  });

  it('returns null when no field is a recognized column name', () => {
    expect(mapHeader(['foo', 'bar'])).toBeNull();
  });
});

describe('parseBulkCsv', () => {
  it('parses valid rows, skipping the header row', () => {
    const result = parseBulkCsv(
      'phone_number,amount,reason\n9876543210,100,Diwali\n9876500000,50\n',
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ rowNumber: 1, phone: '+919876543210', points: 100 });
    expect(result.rows[0]?.reason).toBe('Diwali');
    expect(result.rows[1]?.reason).toBeUndefined();
    expect(result.invalid).toHaveLength(0);
    expect(result.totalPoints).toBe(150);
    expect(result.headerDetected).toBe(true);
  });

  it('works without a header row', () => {
    const result = parseBulkCsv('9876543210,100\n9876500000,50');
    expect(result.rows).toHaveLength(2);
    expect(result.totalPoints).toBe(150);
    expect(result.headerDetected).toBe(false);
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
    expect(result.invalid[0]?.error).toMatch(/mobile number/i);
    expect(result.invalid[1]?.error).toMatch(/whole number/i);
  });

  it('accepts E.164 and spaced/dashed phone formats, normalizing all of them', () => {
    const result = parseBulkCsv('+919876543210,10\n"98765-43210",20\n"98765 43210",30');
    expect(result.rows.map((r) => r.phone)).toEqual([
      '+919876543210',
      '+919876543210',
      '+919876543210',
    ]);
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

  it('collapses format variants of the same phone into one customer', () => {
    // Pre-fix these counted as 3 unique customers and totalled 60 — the file
    // actually credits ONE customer 30 coins.
    const result = parseBulkCsv('9876543210,10\n+919876543210,20\n09876543210,30');
    expect(result.duplicateCount).toBe(2);
    expect(result.uniquePhones).toBe(1);
    expect(result.totalPoints).toBe(30);
  });

  // ─── The blocker: files that used to yield ZERO valid rows ────────────────

  it('parses a semicolon-delimited file (Excel European locale)', () => {
    const result = parseBulkCsv('phone_number;amount;reason\n9876543210;100;Diwali\n9876500000;50');
    expect(result.invalid).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.delimiter).toBe(';');
    expect(result.totalPoints).toBe(150);
  });

  it('parses a tab-delimited file', () => {
    const result = parseBulkCsv('phone_number\tamount\n9876543210\t100');
    expect(result.rows).toHaveLength(1);
    expect(result.delimiter).toBe('\t');
  });

  it('strips a UTF-8 BOM (Excel "CSV UTF-8" export)', () => {
    const result = parseBulkCsv('﻿phone_number,amount\n9876543210,100');
    expect(result.headerDetected).toBe(true);
    expect(result.invalid).toHaveLength(0);
    expect(result.rows[0]?.phone).toBe('+919876543210');
  });

  it('strips a BOM on a headerless file', () => {
    const result = parseBulkCsv('﻿9876543210,100');
    expect(result.invalid).toHaveLength(0);
    expect(result.rows[0]?.phone).toBe('+919876543210');
  });

  it('honors header order instead of assuming phone comes first', () => {
    const result = parseBulkCsv('amount,phone_number\n100,9876543210');
    expect(result.invalid).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ phone: '+919876543210', points: 100 });
  });

  it('accepts Excel-formatted amounts', () => {
    const result = parseBulkCsv('phone_number,amount\n9876543210,"1,000"\n9876500000,500.00');
    expect(result.invalid).toHaveLength(0);
    expect(result.rows.map((r) => r.points)).toEqual([1000, 500]);
  });

  it('distinguishes a missing phone from an invalid one', () => {
    const result = parseBulkCsv('phone_number,amount\n,100\n9876543210,');
    expect(result.invalid[0]?.error).toMatch(/missing/i);
    expect(result.invalid[1]?.error).toMatch(/missing/i);
  });

  it('reports a header-only file as having no rows at all', () => {
    const result = parseBulkCsv('phone_number,amount,reason\n');
    expect(result.rows).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
    expect(result.headerDetected).toBe(true);
  });
});

describe('BULK_CSV_TEMPLATE', () => {
  it('round-trips through the parser with no invalid rows', () => {
    // The sample we hand merchants must be valid by construction — otherwise
    // "download, fill in, upload" fails on the very first try.
    const result = parseBulkCsv(BULK_CSV_TEMPLATE);
    expect(result.invalid).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.headerDetected).toBe(true);
    expect(result.totalPoints).toBe(750);
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
