import { Inject, Injectable } from '@nestjs/common';
import type { FormField } from '@ratio-app/shared/schemas/form-schema';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { SubmissionsService } from './submissions.service';

/** Rows fetched per page while streaming — bounds memory, not history. */
const EXPORT_BATCH_SIZE = 500;

/** Where the streamed CSV chunks go (the controller wires the raw response). */
export interface CsvSink {
  write(chunk: string): void | Promise<void>;
}

/** Keyset cursor: the last row's stable sort key `(createdAt, id)`. */
interface ExportCursor {
  createdAt: Date;
  id: string;
}

/**
 * Full-history CSV export (AC8): streams in `EXPORT_BATCH_SIZE` pages — never
 * buffers the whole table. Header = the form schema's field keys +
 * `submitted_at`; values escaped per RFC 4180 (quotes doubled; any value
 * containing a comma, quote, or newline is quoted).
 *
 * Pages by KEYSET on `(createdAt, id)` rather than LIMIT/OFFSET, so the cost
 * of reaching page N is independent of N (O(n) over the whole export instead
 * of O(n²)): each batch resumes from the previous batch's last key via
 * `(createdAt, id) > (lastCreatedAt, lastId)`. `id` is the tiebreaker for rows
 * sharing a `createdAt` millisecond, which keeps the ordering total (no row
 * skipped or duplicated at a batch boundary).
 *
 * Works for soft-deleted forms too — submissions outlive the form (AC4).
 * Returns the number of data rows written (header excluded) — the async
 * export job records this as `row_count`.
 */
@Injectable()
export class CsvExportService {
  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly submissions: SubmissionsService,
  ) {}

  async export(merchantId: string, formId: string, sink: CsvSink): Promise<number> {
    // Includes soft-deleted forms (requireOwnForm has no deleted_at filter).
    const form = await this.submissions.requireOwnForm(merchantId, formId);
    const schema: FormField[] =
      typeof form.schemaJson === 'string'
        ? (JSON.parse(form.schemaJson) as FormField[])
        : form.schemaJson;
    const keys = schema.map((f) => f.key);

    await sink.write(`${[...keys, 'submitted_at'].map(CsvExportService.escape).join(',')}\n`);

    let cursor: ExportCursor | null = null;
    let rowCount = 0;
    for (;;) {
      let query = this.handle.db
        .selectFrom('form_submissions')
        .select(['id', 'dataJson', 'filesJson', 'createdAt'])
        .where('formId', '=', formId)
        .where('merchantId', '=', merchantId);
      if (cursor) {
        const c = cursor;
        // (createdAt, id) > (c.createdAt, c.id) — decomposed into OR/AND so it
        // works uniformly across engines (MySQL supports row-value tuples, but
        // this form keeps the query plan predictable on the composite key).
        query = query.where((eb) =>
          eb.or([
            eb('createdAt', '>', c.createdAt),
            eb.and([eb('createdAt', '=', c.createdAt), eb('id', '>', c.id)]),
          ]),
        );
      }
      const rows = await query
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')
        .limit(EXPORT_BATCH_SIZE)
        .execute();
      for (const row of rows) {
        const data = CsvExportService.parse<Record<string, unknown>>(row.dataJson) ?? {};
        const files = CsvExportService.parse<Record<string, string>>(row.filesJson) ?? {};
        const cells = keys.map((key) =>
          CsvExportService.escape(CsvExportService.cell(data[key] ?? files[key])),
        );
        cells.push(CsvExportService.escape(new Date(row.createdAt).toISOString()));
        await sink.write(`${cells.join(',')}\n`);
        rowCount += 1;
      }
      const last = rows.at(-1);
      if (rows.length < EXPORT_BATCH_SIZE || !last) break;
      cursor = { createdAt: new Date(last.createdAt), id: last.id };
    }
    return rowCount;
  }

  private static parse<T>(value: T | string | null): T | null {
    if (value === null) return null;
    return typeof value === 'string' ? (JSON.parse(value) as T) : value;
  }

  /** Flatten a submitted value to one CSV cell. */
  private static cell(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(String).join('; ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /** RFC 4180: quote when the value carries a comma, quote, or newline. */
  private static escape(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
