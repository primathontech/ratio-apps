import { describe, expect, it } from 'vitest';
import { CsvExportService } from '../../../../src/modules/forms/submissions/csv-export.service';
import { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';
import { makeFakeHandle, type Row } from './fixtures/fake-db';
import { contactForm, MERCHANT_ID, submissionRow } from './fixtures/forms';

function setup(seed: Record<string, Row[]>) {
  const fake = makeFakeHandle(seed);
  // Only requireOwnForm is exercised — the collaborators are never touched.
  const submissions = new SubmissionsService(
    fake.handle,
    // biome-ignore lint/suspicious/noExplicitAny: unused collaborators
    ...([{}, {}, {}, {}, {}] as any[]),
  );
  const service = new CsvExportService(fake.handle, submissions);
  const chunks: string[] = [];
  const sink = {
    write: (chunk: string) => {
      chunks.push(chunk);
    },
  };
  return { service, chunks, sink };
}

describe('CsvExportService (AC8)', () => {
  it('streams header = schema field keys + submitted_at, one chunk per row (no buffering)', async () => {
    const { service, chunks, sink } = setup({
      forms: [contactForm()],
      form_submissions: [
        submissionRow({
          id: 'sub_1',
          idempotencyKey: 'k1',
          createdAt: new Date('2026-02-01T10:00:00Z'),
        }),
        submissionRow({
          id: 'sub_2',
          idempotencyKey: 'k2',
          dataJson: JSON.stringify({ name: 'Ravi', email: 'ravi@example.com', message: 'Yo' }),
          createdAt: new Date('2026-02-01T11:00:00Z'),
        }),
      ],
    });
    await service.export(MERCHANT_ID, 'form_contact', sink);

    expect(chunks[0]).toBe('name,email,message,submitted_at\n');
    // Chunked: header + one write per row — the sink observes 3 discrete writes.
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toBe('Asha,asha@example.com,Hi,2026-02-01T10:00:00.000Z\n');
    expect(chunks[2]).toContain('Ravi');
  });

  it('escapes commas, quotes, and newlines per RFC 4180', async () => {
    const { service, chunks, sink } = setup({
      forms: [contactForm()],
      form_submissions: [
        submissionRow({
          dataJson: JSON.stringify({
            name: 'Rao, Asha',
            email: 'asha@example.com',
            message: 'She said "hi"\nthen left',
          }),
        }),
      ],
    });
    await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(chunks[1]).toContain('"Rao, Asha"');
    expect(chunks[1]).toContain('"She said ""hi""\nthen left"');
  });

  it('flattens arrays (multi_select) and fills missing keys with empty cells', async () => {
    const { service, chunks, sink } = setup({
      forms: [contactForm()],
      form_submissions: [
        submissionRow({ dataJson: JSON.stringify({ name: ['a', 'b'], message: undefined }) }),
      ],
    });
    await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(chunks[1]).toBe(`a; b,,,${new Date(submissionRow().createdAt).toISOString()}\n`);
  });

  it('includes file object keys in the cell for file fields', async () => {
    const { service, chunks, sink } = setup({
      forms: [contactForm()],
      form_submissions: [
        submissionRow({
          dataJson: JSON.stringify({ name: 'Asha' }),
          filesJson: JSON.stringify({ email: 'm_1/form_contact/d/email' }),
        }),
      ],
    });
    await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(chunks[1]).toContain('m_1/form_contact/d/email');
  });

  it('works for soft-deleted forms — submissions outlive the form (AC4)', async () => {
    const { service, chunks, sink } = setup({
      forms: [contactForm({ deletedAt: new Date() })],
      form_submissions: [submissionRow()],
    });
    await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(chunks).toHaveLength(2);
  });

  it('is merchant-scoped: exporting another merchant’s form → 404', async () => {
    const { service, sink } = setup({
      forms: [contactForm()],
      form_submissions: [submissionRow()],
    });
    await expect(service.export('m_other', 'form_contact', sink)).rejects.toThrow();
  });

  it('pages through history in batches (full export beyond one batch)', async () => {
    const rows = Array.from({ length: 501 }, (_, i) =>
      submissionRow({
        id: `sub_${String(i).padStart(3, '0')}`,
        idempotencyKey: `k${i}`,
        dataJson: JSON.stringify({ name: `n${i}`, email: 'e@example.com', message: '' }),
        createdAt: new Date(1_700_000_000_000 + i * 1000),
      }),
    );
    const { service, chunks, sink } = setup({
      forms: [contactForm()],
      form_submissions: rows,
    });
    const rowCount = await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(rowCount).toBe(501); // returns the data-row count (header excluded)
    expect(chunks).toHaveLength(502); // header + 501 rows across two pages
    expect(chunks[1]).toContain('n0'); // oldest first (created_at ASC)
    expect(chunks.at(-1)).toContain('n500');
  });

  it('keyset: no row is skipped or duplicated across the batch boundary', async () => {
    // 501 rows across two pages (batch size 500). The keyset cursor resumes on
    // (createdAt, id) > (last, last), so the row straddling the boundary must
    // appear exactly once.
    const rows = Array.from({ length: 501 }, (_, i) =>
      submissionRow({
        id: `sub_${String(i).padStart(3, '0')}`,
        idempotencyKey: `k${i}`,
        dataJson: JSON.stringify({ name: `n${i}`, email: 'e@example.com', message: '' }),
        createdAt: new Date(1_700_000_000_000 + i * 1000),
      }),
    );
    const { service, chunks, sink } = setup({ forms: [contactForm()], form_submissions: rows });
    await service.export(MERCHANT_ID, 'form_contact', sink);
    const names = chunks.slice(1).map((c) => c.split(',')[0]);
    expect(new Set(names).size).toBe(501); // every row exactly once — no dup/skip
    expect(names[499]).toBe('n499'); // last row of page 1
    expect(names[500]).toBe('n500'); // first row of page 2 — the boundary row
  });

  it('keyset tiebreaker: rows sharing a createdAt millisecond order by id, still complete', async () => {
    // All 501 rows share one createdAt: ordering therefore falls entirely to
    // the `id` tiebreaker, and the cursor must page by id across the boundary
    // without losing or repeating a row.
    const sameTime = new Date('2026-03-01T00:00:00.000Z');
    const rows = Array.from({ length: 501 }, (_, i) =>
      submissionRow({
        id: `sub_${String(i).padStart(3, '0')}`,
        idempotencyKey: `k${i}`,
        dataJson: JSON.stringify({ name: `n${i}`, email: 'e@example.com', message: '' }),
        createdAt: sameTime,
      }),
    );
    const { service, chunks, sink } = setup({ forms: [contactForm()], form_submissions: rows });
    const rowCount = await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(rowCount).toBe(501);
    const names = chunks.slice(1).map((c) => c.split(',')[0]);
    expect(new Set(names).size).toBe(501);
    expect(names[0]).toBe('n0'); // id sub_000 sorts first
    expect(names.at(-1)).toBe('n500'); // id sub_500 sorts last
  });
});
