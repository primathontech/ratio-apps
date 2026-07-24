import type { Merchant } from '@ratio-app/shared/schemas/merchant';
import { describe, expect, it, vi } from 'vitest';
import type { WebhookDeliveryService } from '../../../../src/modules/forms/delivery/webhook-delivery.service';
import { FormsMerchantTokenGuard } from '../../../../src/modules/forms/guards';
import type { CsvExportService } from '../../../../src/modules/forms/submissions/csv-export.service';
import type { ExportJobService } from '../../../../src/modules/forms/submissions/export-job.service';
import { SubmissionsController } from '../../../../src/modules/forms/submissions/submissions.controller';
import type { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';
import { contactForm } from './fixtures/forms';

const merchant = { id: 'm_1' } as Merchant;

function makeController() {
  const submissions = {
    requireOwnForm: vi.fn(async () => contactForm()),
  };
  const csv = {
    export: vi.fn(async (_m: string, _f: string, sink: { write: (c: string) => void }) => {
      await sink.write('name,email,submitted_at\n');
      await sink.write('Asha,asha@example.com,2026-02-01T10:00:00.000Z\n');
      return 1;
    }),
  };
  const webhookDelivery = {} as WebhookDeliveryService;
  const exportJobs = {
    createJob: vi.fn(async () => ({ id: 'exp_1', status: 'pending' })),
    getJob: vi.fn(async () => ({
      status: 'ready',
      rowCount: 5,
      downloadUrl: 'https://fake-s3/m_1/form_contact/exports/exp_1.csv?sig=get',
    })),
  };
  const controller = new SubmissionsController(
    submissions as unknown as SubmissionsService,
    csv as unknown as CsvExportService,
    webhookDelivery,
    exportJobs as unknown as ExportJobService,
  );
  return { controller, submissions, csv, exportJobs };
}

describe('SubmissionsController — export endpoints', () => {
  it('is guarded by the merchant-token guard', () => {
    const guards = Reflect.getMetadata('__guards__', SubmissionsController) as unknown[];
    expect(guards).toContain(FormsMerchantTokenGuard);
  });

  it('sync export still streams: validates ownership, hijacks, writes CSV chunks', async () => {
    const { controller, submissions } = makeController();
    const written: string[] = [];
    const reply = {
      hijack: vi.fn(),
      raw: {
        writeHead: vi.fn(),
        write: (chunk: string) => written.push(chunk),
        end: vi.fn(),
      },
    };
    const req = { headers: {} };

    // biome-ignore lint/suspicious/noExplicitAny: minimal Fastify req/reply doubles
    await controller.export(merchant, 'form_contact', req as any, reply as any);

    expect(submissions.requireOwnForm).toHaveBeenCalledWith('m_1', 'form_contact');
    expect(reply.hijack).toHaveBeenCalled();
    expect(reply.raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'content-type': 'text/csv; charset=utf-8',
      }),
    );
    expect(written.join('')).toContain('name,email,submitted_at');
    expect(written.join('')).toContain('Asha');
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('POST exports delegates to createJob and returns { jobId, status }', async () => {
    const { controller, exportJobs } = makeController();
    const result = await controller.createExport(merchant, 'form_contact');
    expect(exportJobs.createJob).toHaveBeenCalledWith('m_1', 'form_contact');
    expect(result).toEqual({ jobId: 'exp_1', status: 'pending' });
  });

  it('GET exports/:jobId delegates to getJob and returns the status view', async () => {
    const { controller, exportJobs } = makeController();
    const result = await controller.exportStatus(merchant, 'form_contact', 'exp_1');
    expect(exportJobs.getJob).toHaveBeenCalledWith('m_1', 'form_contact', 'exp_1');
    expect(result).toMatchObject({ status: 'ready', rowCount: 5 });
    expect(result.downloadUrl).toContain('exp_1.csv');
  });
});
