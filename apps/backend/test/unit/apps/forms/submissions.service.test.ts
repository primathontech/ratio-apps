import { HttpException, Logger } from '@nestjs/common';
import { appearanceSchema } from '@ratio-app/shared/schemas/form-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormsRecaptchaService } from '../../../../src/modules/forms/spam/recaptcha.service';
import type { SubmitRateLimitService } from '../../../../src/modules/forms/spam/submit-rate-limit.service';
import { IdempotencyService } from '../../../../src/modules/forms/submissions/idempotency.service';
import { SchemaValidatorService } from '../../../../src/modules/forms/submissions/schema-validator.service';
import { SubmissionsService } from '../../../../src/modules/forms/submissions/submissions.service';
import type { FormsS3Service } from '../../../../src/modules/forms/uploads/s3.service';
import { type FakeHandle, makeFakeHandle, type Row } from './fixtures/fake-db';
import {
  configRow,
  contactForm,
  emptySchemaForm,
  kitchenSinkForm,
  MERCHANT_ID,
  submissionRow,
} from './fixtures/forms';
import { VALID_CONTACT_PAYLOAD } from './fixtures/submissions';

interface Setup {
  service: SubmissionsService;
  fake: FakeHandle;
  rateLimit: { allow: ReturnType<typeof vi.fn> };
  recaptcha: { verify: ReturnType<typeof vi.fn> };
  validator: SchemaValidatorService;
  validateSpy: ReturnType<typeof vi.spyOn>;
  s3: { signedGetUrl: ReturnType<typeof vi.fn> };
}

function setup(seed: Record<string, Row[]>): Setup {
  const fake = makeFakeHandle(seed);
  const rateLimit = { allow: vi.fn(async () => true) };
  const recaptcha = { verify: vi.fn(async () => ({ verdict: 'pass' as const, score: 0.9 })) };
  const validator = new SchemaValidatorService();
  const validateSpy = vi.spyOn(validator, 'validate');
  const s3 = { signedGetUrl: vi.fn(async (key: string) => `https://fake-s3/${key}?sig=get`) };
  const service = new SubmissionsService(
    fake.handle,
    rateLimit as unknown as SubmitRateLimitService,
    recaptcha as unknown as FormsRecaptchaService,
    validator,
    new IdempotencyService(),
    s3 as unknown as FormsS3Service,
  );
  return { service, fake, rateLimit, recaptcha, validator, validateSpy, s3 };
}

const meta = { ip: '203.0.113.9', sessionKey: 'sess_1' };

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  errorCode: string,
): Promise<void> {
  try {
    await promise;
    expect.unreachable(`expected HTTP ${status} ${errorCode}`);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    expect(http.getStatus()).toBe(status);
    expect((http.getResponse() as { error_code?: string }).error_code).toBe(errorCode);
  }
}

describe('SubmissionsService.submitPublic — the PublicFormGuard chain (AC6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('(1) rate limit short-circuits FIRST: 429 before form state, spam, or validation', async () => {
    const { service, fake, rateLimit, recaptcha, validateSpy } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    rateLimit.allow.mockResolvedValueOnce(false);
    await expectHttpError(
      service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta),
      429,
      'RATE_LIMITED',
    );
    expect(recaptcha.verify).not.toHaveBeenCalled();
    expect(validateSpy).not.toHaveBeenCalled();
    expect(fake.inserts).toHaveLength(0);
  });

  it('(2) kill switch → 403 form_unavailable before the spam check', async () => {
    const { service, recaptcha } = setup({
      forms: [kitchenSinkForm()],
      forms_configs: [configRow({ formsEnabled: false })],
    });
    await expectHttpError(
      service.submitPublic('form_sink', VALID_CONTACT_PAYLOAD, meta),
      403,
      'form_unavailable',
    );
    expect(recaptcha.verify).not.toHaveBeenCalled();
  });

  it('(2) inactive form → 403 form_inactive (AC3); deleted/missing → 403 form_unavailable', async () => {
    const { service } = setup({
      forms: [
        contactForm({ status: 'inactive' }),
        contactForm({ id: 'form_gone', deletedAt: new Date() }),
      ],
      forms_configs: [configRow()],
    });
    await expectHttpError(
      service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta),
      403,
      'form_inactive',
    );
    await expectHttpError(
      service.submitPublic('form_gone', VALID_CONTACT_PAYLOAD, meta),
      403,
      'form_unavailable',
    );
    await expectHttpError(
      service.submitPublic('form_never_existed', VALID_CONTACT_PAYLOAD, meta),
      403,
      'form_unavailable',
    );
  });

  it('(3) recaptcha reject → SILENT fake success: 200-shaped id, nothing stored, counter++, validator never runs (F7)', async () => {
    const logged: unknown[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });
    const { service, fake, recaptcha, validateSpy } = setup({
      forms: [kitchenSinkForm()],
      forms_configs: [configRow()],
    });
    recaptcha.verify.mockResolvedValueOnce({ verdict: 'reject', score: 0.1 });

    const result = await service.submitPublic(
      'form_sink',
      { fields: { email: 'bot@example.com' }, recaptchaToken: 'tok' },
      meta,
    );
    expect(result.submissionId).toMatch(/^sub_/);
    expect(fake.inserts).toHaveLength(0);
    expect(validateSpy).not.toHaveBeenCalled();
    expect(service.rejectedCount('form_sink')).toBe(1);
    // Redaction: the silent-reject log line carries no submission values.
    expect(JSON.stringify(logged)).not.toContain('bot@example.com');
  });

  it('(3) siteverify unavailable → honeypot-only fallback: clean _hp proceeds with null score (F8)', async () => {
    const { service, fake, recaptcha } = setup({
      forms: [kitchenSinkForm({ schemaJson: contactForm().schemaJson })],
      forms_configs: [configRow()],
    });
    recaptcha.verify.mockResolvedValueOnce({ verdict: 'unavailable' });

    const result = await service.submitPublic(
      'form_sink',
      { ...VALID_CONTACT_PAYLOAD, _hp: '' },
      meta,
    );
    expect(result.submissionId).toMatch(/^sub_/);
    const insert = fake.inserts.find((i) => i.table === 'form_submissions');
    expect(insert?.values.recaptchaScore).toBeNull();
  });

  it('(3) siteverify unavailable + filled _hp → silent reject', async () => {
    const { service, fake, recaptcha } = setup({
      forms: [kitchenSinkForm()],
      forms_configs: [configRow()],
    });
    recaptcha.verify.mockResolvedValueOnce({ verdict: 'unavailable' });
    await service.submitPublic('form_sink', { fields: {}, _hp: 'gotcha' }, meta);
    expect(fake.inserts).toHaveLength(0);
    expect(service.rejectedCount('form_sink')).toBe(1);
  });

  it('(3) honeypot mode: filled _hp → silent reject; recaptcha never consulted', async () => {
    const { service, fake, recaptcha } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    const result = await service.submitPublic(
      'form_contact',
      { ...VALID_CONTACT_PAYLOAD, _hp: 'bot-filled' },
      meta,
    );
    expect(result.submissionId).toMatch(/^sub_/);
    expect(fake.inserts).toHaveLength(0);
    expect(recaptcha.verify).not.toHaveBeenCalled();
    expect(service.rejectedCount('form_contact')).toBe(1);
  });

  it('(4) schema validation failure → 422 with per-field errors, nothing stored', async () => {
    const { service, fake } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    try {
      await service.submitPublic(
        'form_contact',
        { fields: { name: '', email: 'nope', message: 'hi' } },
        meta,
      );
      expect.unreachable('expected 422');
    } catch (err) {
      const http = err as HttpException;
      expect(http.getStatus()).toBe(422);
      const body = http.getResponse() as { details?: { fields?: Record<string, string> } };
      expect(body.details?.fields?.name).toBeDefined();
      expect(body.details?.fields?.email).toBeDefined();
    }
    expect(fake.inserts).toHaveLength(0);
  });

  it('(6) stores data_json/files_json stringified + recaptcha score + idempotency key (AC7)', async () => {
    const { service, fake, recaptcha } = setup({
      forms: [kitchenSinkForm({ schemaJson: contactForm().schemaJson })],
      forms_configs: [configRow()],
    });
    recaptcha.verify.mockResolvedValueOnce({ verdict: 'pass', score: 0.87 });

    const result = await service.submitPublic(
      'form_sink',
      { ...VALID_CONTACT_PAYLOAD, recaptchaToken: 'tok' },
      meta,
    );
    expect(result.submissionId).toMatch(/^sub_/);
    const insert = fake.inserts.find((i) => i.table === 'form_submissions');
    expect(insert).toBeDefined();
    expect(typeof insert?.values.dataJson).toBe('string');
    expect(JSON.parse(insert?.values.dataJson as string)).toEqual(VALID_CONTACT_PAYLOAD.fields);
    expect(insert?.values.recaptchaScore).toBe(0.87);
    expect(insert?.values.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(insert?.values.merchantId).toBe(MERCHANT_ID);
  });

  it('(5) duplicate in the same 5s bucket → 409 duplicate_submission (F10)', async () => {
    const { service } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    const first = await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    expect(first.submissionId).toMatch(/^sub_/);
    // 4.9s later — same bucket, same session → UNIQUE collision → 409.
    vi.advanceTimersByTime(4_900);
    await expectHttpError(
      service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta),
      409,
      'duplicate_submission',
    );
  });

  it('(5) duplicate 409 returns the ORIGINAL submissionId so a client can reconcile (P3-2)', async () => {
    const { service } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    const first = await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    vi.advanceTimersByTime(4_900);
    try {
      await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
      expect.unreachable('expected 409');
    } catch (err) {
      const http = err as HttpException;
      expect(http.getStatus()).toBe(409);
      const body = http.getResponse() as { error_code?: string; submissionId?: string };
      expect(body.error_code).toBe('duplicate_submission');
      expect(body.submissionId).toBe(first.submissionId);
    }
  });

  it('(6) insert + enqueue are atomic: an enqueue failure rolls back the submission so the retry re-inserts (P3-1)', async () => {
    const { service, fake } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    const enqueueSpy = vi
      .spyOn(service as unknown as { enqueueDeliveries: () => Promise<void> }, 'enqueueDeliveries')
      .mockRejectedValueOnce(new Error('delivery boom'));
    await expect(service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta)).rejects.toThrow(
      'delivery boom',
    );
    // The transaction rolled back — no orphaned submission row.
    expect(fake.inserts.filter((i) => i.table === 'form_submissions')).toHaveLength(0);
    expect(fake.inserts.filter((i) => i.table === 'form_email_log')).toHaveLength(0);

    // Retry in the SAME 5s bucket now succeeds (no phantom 409) and delivers.
    enqueueSpy.mockRestore();
    const retry = await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    expect(retry.submissionId).toMatch(/^sub_/);
    expect(fake.inserts.filter((i) => i.table === 'form_submissions')).toHaveLength(1);
    expect(fake.inserts.filter((i) => i.table === 'form_email_log')).toHaveLength(1);
  });

  it('(5) 5.1s later lands in the next bucket → accepted', async () => {
    const { service, fake } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    vi.advanceTimersByTime(5_100);
    await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    expect(fake.inserts.filter((i) => i.table === 'form_submissions')).toHaveLength(2);
  });

  it('(7) enqueues the email row (recipient = form email ?? config default) and the webhook row only when webhook_url is set (AC9/AC10)', async () => {
    const { service, fake, recaptcha } = setup({
      forms: [
        contactForm(), // no form email (config default), no webhook
        kitchenSinkForm({ schemaJson: contactForm().schemaJson }), // both set
      ],
      forms_configs: [configRow()],
    });
    recaptcha.verify.mockResolvedValue({ verdict: 'pass', score: 0.9 });

    await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    const contactEmail = fake.inserts.filter((i) => i.table === 'form_email_log');
    expect(contactEmail).toHaveLength(1);
    expect(contactEmail[0]?.values.recipient).toBe('owner@merchant.example');
    expect(fake.inserts.filter((i) => i.table === 'form_webhook_deliveries')).toHaveLength(0);

    await service.submitPublic(
      'form_sink',
      { ...VALID_CONTACT_PAYLOAD, recaptchaToken: 'tok' },
      { ip: meta.ip, sessionKey: 'sess_2' },
    );
    const sinkEmail = fake.inserts.filter((i) => i.table === 'form_email_log').at(-1);
    expect(sinkEmail?.values.recipient).toBe('forms@merchant.example');
    const webhook = fake.inserts.filter((i) => i.table === 'form_webhook_deliveries');
    expect(webhook).toHaveLength(1);
    expect(webhook[0]?.values).toMatchObject({
      formId: 'form_sink',
      url: 'https://hooks.merchant.example/forms',
      status: 'pending',
    });
    expect(webhook[0]?.values.nextRetryAt).toEqual(new Date('2026-02-01T10:00:00Z'));
  });

  it('(7) skips the email row when neither form email nor config default is set', async () => {
    const { service, fake } = setup({
      forms: [contactForm()],
      forms_configs: [configRow({ defaultNotificationEmail: null })],
    });
    await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, meta);
    expect(fake.inserts.filter((i) => i.table === 'form_email_log')).toHaveLength(0);
  });

  it('falls back to the IP as the idempotency scope when no session key is given', async () => {
    const { service, fake } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, { ip: '203.0.113.9' });
    await expectHttpError(
      service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, { ip: '203.0.113.9' }),
      409,
      'duplicate_submission',
    );
    // A different IP in the same bucket is NOT a duplicate.
    await service.submitPublic('form_contact', VALID_CONTACT_PAYLOAD, { ip: '198.51.100.1' });
    expect(fake.inserts.filter((i) => i.table === 'form_submissions')).toHaveLength(2);
  });
});

describe('SubmissionsService.getPublicSchema — the render-schema read (AC4/AC11)', () => {
  const savedSiteKey = process.env.FORMS_RECAPTCHA_SHARED_SITE_KEY;

  beforeEach(() => {
    delete process.env.FORMS_RECAPTCHA_SHARED_SITE_KEY;
  });

  afterEach(() => {
    if (savedSiteKey === undefined) delete process.env.FORMS_RECAPTCHA_SHARED_SITE_KEY;
    else process.env.FORMS_RECAPTCHA_SHARED_SITE_KEY = savedSiteKey;
  });

  it('returns the redacted render schema — never notification_email / webhook_url / secrets', async () => {
    const { service } = setup({
      forms: [kitchenSinkForm()],
      forms_configs: [configRow({ recaptchaSiteKey: 'site-key-123', recaptchaSecretEnc: 'enc' })],
    });
    const schema = await service.getPublicSchema('form_sink');
    expect(schema.id).toBe('form_sink');
    expect(Array.isArray(schema.schema)).toBe(true);
    expect(schema.recaptchaSiteKey).toBe('site-key-123');
    const json = JSON.stringify(schema);
    expect(json).not.toContain('forms@merchant.example');
    expect(json).not.toContain('hooks.merchant.example');
    expect(json).not.toContain('recaptchaSecretEnc');
    expect(json).not.toContain('enc');
  });

  it('falls back to the shared env site key when the merchant has none', async () => {
    process.env.FORMS_RECAPTCHA_SHARED_SITE_KEY = 'shared-site-key';
    const { service } = setup({
      forms: [kitchenSinkForm()],
      forms_configs: [configRow()],
    });
    expect((await service.getPublicSchema('form_sink')).recaptchaSiteKey).toBe('shared-site-key');
  });

  it('deleted or never-existed → 404 form_not_available (indistinguishable, AC4)', async () => {
    const { service } = setup({
      forms: [contactForm({ deletedAt: new Date() })],
      forms_configs: [configRow()],
    });
    await expectHttpError(service.getPublicSchema('form_contact'), 404, 'form_not_available');
    await expectHttpError(service.getPublicSchema('form_missing'), 404, 'form_not_available');
  });

  it('kill switch → 403 form_unavailable; inactive → 403 form_inactive', async () => {
    const killSwitched = setup({
      forms: [contactForm()],
      forms_configs: [configRow({ formsEnabled: false })],
    });
    await expectHttpError(
      killSwitched.service.getPublicSchema('form_contact'),
      403,
      'form_unavailable',
    );

    const inactive = setup({
      forms: [contactForm({ status: 'inactive' })],
      forms_configs: [configRow()],
    });
    await expectHttpError(inactive.service.getPublicSchema('form_contact'), 403, 'form_inactive');
  });

  it('empty-schema form (misconfigured) → 404 (PRD 10.10.6)', async () => {
    const { service } = setup({
      forms: [emptySchemaForm()],
      forms_configs: [configRow()],
    });
    await expectHttpError(service.getPublicSchema('form_empty'), 404, 'form_not_available');
  });

  it('exposes appearance to the widget when the form is themed (§1.3)', async () => {
    const appearance = appearanceSchema.parse({ colors: { primary: '#123456' } });
    const { service } = setup({
      forms: [kitchenSinkForm({ appearanceJson: JSON.stringify(appearance) })],
      forms_configs: [configRow()],
    });
    const schema = await service.getPublicSchema('form_sink');
    expect(schema.appearance).toEqual(appearance);
  });

  it('omits appearance for un-themed forms (null appearance_json → today’s look)', async () => {
    const { service } = setup({
      forms: [kitchenSinkForm({ appearanceJson: null })],
      forms_configs: [configRow()],
    });
    const schema = await service.getPublicSchema('form_sink');
    expect('appearance' in schema).toBe(false);
  });

  it('exposes description + redirectUrl to the widget when set', async () => {
    const { service } = setup({
      forms: [
        kitchenSinkForm({
          description: 'Reach the sales team',
          redirectUrl: 'https://merchant.example/thanks',
        }),
      ],
      forms_configs: [configRow()],
    });
    const schema = await service.getPublicSchema('form_sink');
    expect(schema.description).toBe('Reach the sales team');
    expect(schema.redirectUrl).toBe('https://merchant.example/thanks');
  });

  it('omits description + redirectUrl when unset (null columns)', async () => {
    const { service } = setup({
      forms: [kitchenSinkForm({ description: null, redirectUrl: null })],
      forms_configs: [configRow()],
    });
    const schema = await service.getPublicSchema('form_sink');
    expect('description' in schema).toBe(false);
    expect('redirectUrl' in schema).toBe(false);
  });

  // Per-field custom CSS is sanitized + field-scoped on the read path so the
  // widget only ever receives shadow-safe, scoped text (server authoritative).
  it('sanitizes + field-scopes each field customCss: scopes the color rule, drops url()', async () => {
    const fields = [
      {
        key: 'name',
        type: 'text',
        label: 'Name',
        required: true,
        // Two rules on the same `input` selector: a benign color rule and a
        // network-reaching url() rule the sanitizer must strip entirely.
        customCss: 'input { color: red; } input { background: url(https://evil/x); }',
      },
    ];
    const { service } = setup({
      forms: [contactForm({ schemaJson: JSON.stringify(fields) })],
      forms_configs: [configRow()],
    });
    const schema = await service.getPublicSchema('form_contact');
    const field = schema.schema[0] as { key: string; customCss?: string };
    expect(field.key).toBe('name');
    const css = field.customCss ?? '';
    // The color rule survives, re-scoped under the field's data-field wrapper.
    expect(css).toContain('[data-field="name"] input');
    expect(css.replace(/\s+/g, '')).toContain('color:red');
    // The url() rule (and its declaration) is gone — no exfiltration vector.
    expect(css).not.toContain('url(');
    expect(css).not.toContain('evil');
    expect(css).not.toContain('background');
    // Every rule that remains is scoped — the raw un-scoped `input {` never ships.
    expect(css).not.toMatch(/(^|[},])\s*input\s*\{/);
  });

  it('leaves fields without customCss untouched (no customCss injected)', async () => {
    const { service } = setup({
      forms: [contactForm()],
      forms_configs: [configRow()],
    });
    const schema = await service.getPublicSchema('form_contact');
    for (const field of schema.schema) {
      expect('customCss' in field).toBe(false);
    }
  });
});

describe('SubmissionsService — admin reads (AC7/AC10)', () => {
  it('lists paginated submissions, created_at DESC, merchant-scoped', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      submissionRow({
        id: `sub_${i}`,
        idempotencyKey: `key_${i}`,
        createdAt: new Date(Date.UTC(2026, 1, 1, 10, i)),
      }),
    );
    const { service } = setup({
      forms: [contactForm()],
      form_submissions: [
        ...rows,
        submissionRow({ id: 'sub_foreign', merchantId: 'm_other', idempotencyKey: 'kf' }),
      ],
      forms_configs: [configRow()],
    });
    const page1 = await service.list(MERCHANT_ID, 'form_contact', 1, 20);
    expect(page1.submissions).toHaveLength(20);
    expect(page1.hasMore).toBe(true);
    expect(page1.submissions[0]?.id).toBe('sub_24'); // newest first
    const page2 = await service.list(MERCHANT_ID, 'form_contact', 2, 20);
    expect(page2.submissions).toHaveLength(5);
    expect(page2.hasMore).toBe(false);
    expect(page2.submissions.map((s) => s.id)).not.toContain('sub_foreign');
  });

  it('detail returns parsed data + 7-day signed GET URLs for file fields', async () => {
    const { service, s3 } = setup({
      forms: [contactForm()],
      form_submissions: [
        submissionRow({
          filesJson: JSON.stringify({ resume: 'm_1/form_contact/draft_abc/resume' }),
        }),
      ],
      forms_configs: [configRow()],
    });
    const detail = await service.detail(MERCHANT_ID, 'sub_1');
    expect(detail.data.name).toBe('Asha');
    expect(detail.fileUrls.resume).toBe(
      'https://fake-s3/m_1/form_contact/draft_abc/resume?sig=get',
    );
    expect(s3.signedGetUrl).toHaveBeenCalledWith('m_1/form_contact/draft_abc/resume');
  });

  it('detail is merchant-scoped: 404 for another merchant', async () => {
    const { service } = setup({
      forms: [contactForm()],
      form_submissions: [submissionRow()],
      forms_configs: [configRow()],
    });
    await expectHttpError(service.detail('m_other', 'sub_1'), 404, 'SUBMISSION_NOT_FOUND');
  });

  it('retrigger flips failed → pending with next_retry_at now; cross-merchant / non-failed → 404 (AC10)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-02T00:00:00Z'));
    try {
      const { service, fake } = setup({
        forms: [contactForm()],
        form_webhook_deliveries: [
          { id: 1, merchantId: MERCHANT_ID, status: 'failed', nextRetryAt: null },
          { id: 2, merchantId: MERCHANT_ID, status: 'delivered', nextRetryAt: null },
          { id: 3, merchantId: 'm_other', status: 'failed', nextRetryAt: null },
        ],
        forms_configs: [configRow()],
      });
      const result = await service.retriggerDelivery(MERCHANT_ID, 1);
      expect(result.status).toBe('pending');
      const row = fake.tables.form_webhook_deliveries?.find((r) => r.id === 1);
      expect(row?.status).toBe('pending');
      expect(row?.nextRetryAt).toEqual(new Date('2026-02-02T00:00:00Z'));

      await expectHttpError(service.retriggerDelivery(MERCHANT_ID, 2), 404, 'DELIVERY_NOT_FOUND');
      await expectHttpError(service.retriggerDelivery(MERCHANT_ID, 3), 404, 'DELIVERY_NOT_FOUND');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SubmissionsService — multi-file storage + hidden context_json (Batch 7)', () => {
  const MULTI_FORM_ID = 'form_multi';
  const schema = [
    {
      key: 'docs',
      type: 'file',
      label: 'Docs',
      required: false,
      maxFiles: 2,
      validation: { allowedMimeTypes: ['application/pdf'], maxBytes: 1024 },
    },
    { key: 'utm', type: 'hidden', label: 'UTM', required: false, paramName: 'utm' },
  ];

  function setupMulti() {
    const fake = makeFakeHandle({
      forms: [contactForm({ id: MULTI_FORM_ID, schemaJson: JSON.stringify(schema) })],
      forms_configs: [configRow()],
    });
    const rateLimit = { allow: vi.fn(async () => true) };
    const recaptcha = { verify: vi.fn(async () => ({ verdict: 'pass' as const, score: 0.9 })) };
    const s3 = {
      exists: vi.fn(async () => true),
      // Field allows only application/pdf — return genuine "%PDF-1.4" head bytes so the P2-3 byte-sniff passes.
      readHeadBytes: vi.fn(
        async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
      ),
      signedGetUrl: vi.fn(async (key: string) => `https://fake-s3/${key}?sig=get`),
    };
    const service = new SubmissionsService(
      fake.handle,
      rateLimit as unknown as SubmitRateLimitService,
      recaptcha as unknown as FormsRecaptchaService,
      new SchemaValidatorService(),
      new IdempotencyService(),
      s3 as unknown as FormsS3Service,
    );
    return { service, fake, s3 };
  }

  const key = (n: string) => `${MERCHANT_ID}/${MULTI_FORM_ID}/${n}/docs`;
  const meta2 = { ip: '203.0.113.9', sessionKey: 'sess_multi' };

  it('stores a multi-file field as an ARRAY in files_json and HEADs every key', async () => {
    const { service, fake, s3 } = setupMulti();
    await service.submitPublic(
      MULTI_FORM_ID,
      { fields: { utm: 'newsletter' }, files: { docs: [key('a'), key('b')] } },
      meta2,
    );
    const insert = fake.inserts.find((i) => i.table === 'form_submissions');
    expect(insert).toBeDefined();
    expect(JSON.parse(insert?.values.filesJson as string)).toEqual({ docs: [key('a'), key('b')] });
    // One existence HEAD per uploaded key.
    expect(s3.exists).toHaveBeenCalledTimes(2);
  });

  it('REJECTS a spoofed upload (declared pdf, bytes are a PNG) with a 422 (P2-3)', async () => {
    const { service, s3 } = setupMulti();
    // Field allows only application/pdf; the stored object's bytes are really a PNG.
    s3.readHeadBytes.mockResolvedValue(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await expectHttpError(
      service.submitPublic(
        MULTI_FORM_ID,
        { fields: { utm: 'newsletter' }, files: { docs: [key('a')] } },
        meta2,
      ),
      422,
      'SUBMISSION_INVALID',
    );
  });

  it('writes hidden-field provenance to context_json (source + raw value)', async () => {
    const { service, fake } = setupMulti();
    await service.submitPublic(
      MULTI_FORM_ID,
      { fields: { utm: 'newsletter' }, files: { docs: [key('a')] } },
      meta2,
    );
    const insert = fake.inserts.find((i) => i.table === 'form_submissions');
    expect(JSON.parse(insert?.values.contextJson as string)).toEqual({
      utm: { source: 'url_param', value: 'newsletter' },
    });
  });

  it('context_json is null when the form resolves no hidden fields', async () => {
    const { service, fake } = setupMulti();
    await service.submitPublic(MULTI_FORM_ID, { fields: {}, files: { docs: [key('a')] } }, meta2);
    const insert = fake.inserts.find((i) => i.table === 'form_submissions');
    expect(insert?.values.contextJson).toBeNull();
  });

  it('detail returns an ARRAY of signed URLs for a multi-file field and the parsed context', async () => {
    // Seed a stored submission row with an array files_json + context_json.
    const fake = makeFakeHandle({
      forms: [contactForm({ id: MULTI_FORM_ID, schemaJson: JSON.stringify(schema) })],
      forms_configs: [configRow()],
      form_submissions: [
        submissionRow({
          id: 'sub_m',
          formId: MULTI_FORM_ID,
          filesJson: JSON.stringify({ docs: [key('a'), key('b')] }),
          contextJson: JSON.stringify({ utm: { source: 'url_param', value: 'newsletter' } }),
        }),
      ],
    });
    const s3 = {
      exists: vi.fn(async () => true),
      signedGetUrl: vi.fn(async (k: string) => `https://fake-s3/${k}?sig=get`),
    };
    const svc = new SubmissionsService(
      fake.handle,
      { allow: vi.fn(async () => true) } as unknown as SubmitRateLimitService,
      { verify: vi.fn() } as unknown as FormsRecaptchaService,
      new SchemaValidatorService(),
      new IdempotencyService(),
      s3 as unknown as FormsS3Service,
    );
    const detail = await svc.detail(MERCHANT_ID, 'sub_m');
    expect(detail.fileUrls.docs).toEqual([
      `https://fake-s3/${key('a')}?sig=get`,
      `https://fake-s3/${key('b')}?sig=get`,
    ]);
    expect(detail.context).toEqual({ utm: { source: 'url_param', value: 'newsletter' } });
  });
});
