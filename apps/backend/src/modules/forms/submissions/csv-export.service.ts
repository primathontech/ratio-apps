import { Inject, Injectable } from '@nestjs/common';
import { type FormField, isCollectableFieldType } from '@ratio-app/shared/schemas/form-schema';
import { csvEscape } from '../../../core/common/csv';
import { parseJsonColumn, parseJsonColumnOrNull } from '../../../core/db/json';
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

/** Full-history CSV export (AC8, RFC 4180), streamed in `EXPORT_BATCH_SIZE` pages by keyset on `(createdAt, id)` so page-N cost is O(n) not O(n²) and `id` keeps ordering total across batch boundaries; returns the data-row count. */
@Injectable()
export class CsvExportService {
  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly submissions: SubmissionsService,
  ) {}

  async export(merchantId: string, formId: string, sink: CsvSink): Promise<number> {
    // Includes soft-deleted forms (requireOwnForm has no deleted_at filter).
    const form = await this.submissions.requireOwnForm(merchantId, formId);
    const schema = parseJsonColumn<FormField[]>(form.schemaJson);
    // Content blocks carry a key but no data_json entry — filter them so the CSV has no phantom empty columns.
    const keys = schema.filter((f) => isCollectableFieldType(f.type)).map((f) => f.key);

    await sink.write(`${[...keys, 'submitted_at'].map(csvEscape).join(',')}\n`);

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
        // (createdAt, id) > (c.createdAt, c.id) decomposed into OR/AND to keep the composite-key query plan predictable.
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
        const data = parseJsonColumn<Record<string, unknown>>(row.dataJson);
        // A multi-file field's value is a key array; `cell` joins with '; ' into one cell.
        const files =
          parseJsonColumnOrNull<Record<string, string | string[]>>(row.filesJson) ?? {};
        const cells = keys.map((key) => csvEscape(CsvExportService.cell(data[key] ?? files[key])));
        cells.push(csvEscape(new Date(row.createdAt).toISOString()));
        await sink.write(`${cells.join(',')}\n`);
        rowCount += 1;
      }
      const last = rows.at(-1);
      if (rows.length < EXPORT_BATCH_SIZE || !last) break;
      cursor = { createdAt: new Date(last.createdAt), id: last.id };
    }
    return rowCount;
  }

  /** Flatten a submitted value to one CSV cell. */
  private static cell(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(String).join('; ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
