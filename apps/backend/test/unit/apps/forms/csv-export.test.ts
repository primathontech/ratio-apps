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
        id: `sub_${i}`,
        idempotencyKey: `k${i}`,
        dataJson: JSON.stringify({ name: `n${i}`, email: 'e@example.com', message: '' }),
        createdAt: new Date(1_700_000_000_000 + i * 1000),
      }),
    );
    const { service, chunks, sink } = setup({
      forms: [contactForm()],
      form_submissions: rows,
    });
    await service.export(MERCHANT_ID, 'form_contact', sink);
    expect(chunks).toHaveLength(502); // header + 501 rows across two pages
    expect(chunks[1]).toContain('n0'); // oldest first (created_at ASC)
    expect(chunks.at(-1)).toContain('n500');
  });
});
