import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  FORM_SUBMITTED_EVENT,
  FORM_SUBMITTED_SCHEMA_VERSION,
  FORMS_WEBHOOK_MAX_ATTEMPTS,
  FORMS_WEBHOOK_RETRY_DELAYS_MS,
  type FormSubmittedPayload,
} from '@ratio-app/shared/constants/forms-events';
import type { FormField } from '@ratio-app/shared/schemas/form-schema';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormRow, FormsDatabase, FormWebhookDeliveryRow } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FormsS3Service } from '../uploads/s3.service';

/** Live delivery timeout (TRD: 10s); the admin "send test payload" uses 5s. */
const DELIVERY_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 5_000;

/** Minimal fetch shape — injectable so tests script status codes/outages. */
export type DeliveryFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number }>;

/** DI token for the fetch override (unset in prod → global fetch). */
export const FORMS_DELIVERY_FETCH = Symbol.for('ratio-app:forms:delivery-fetch');

/**
 * The webhook delivery EXECUTOR — one attempt per call, invoked by the
 * SQS worker for each swept row (the DB is the scheduler, TRD §1: the
 * minute sweeper claims due rows and enqueues `{ deliveryId }`; the worker
 * loads the row and calls {@link execute}).
 *
 * State machine per attempt:
 *   2xx                → `delivered` (+ last_status_code)
 *   non-2xx / network  → attempts+1; before attempt FORMS_WEBHOOK_MAX_ATTEMPTS
 *                        → `pending` with next_retry_at = now + 5m/20m/…;
 *                        at max → `failed` (+ last_status_code) — the "dead
 *                        letter" the admin can manually re-trigger.
 *
 * PII: the payload (submission fields) NEVER reaches a log line — logs carry
 * ids, attempt counts, and status codes only.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly fetchImpl: DeliveryFetchLike;

  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly s3: FormsS3Service,
    @Optional() @Inject(FORMS_DELIVERY_FETCH) fetchImpl?: DeliveryFetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as DeliveryFetchLike);
  }

  /** One delivery attempt for a claimed row. Never throws (state → the row). */
  async execute(row: FormWebhookDeliveryRow): Promise<void> {
    const payload = await this.buildPayload(row);
    if (!payload) {
      // Submission or form vanished (should not happen) — dead-letter it.
      await this.persistFailure(row, null);
      return;
    }
    let statusCode: number | null = null;
    try {
      statusCode = (await this.post(row.url, payload, DELIVERY_TIMEOUT_MS)).status;
    } catch {
      // Network error / timeout. Never log the caught error object — fetch
      // errors can echo the request body (submission PII).
      statusCode = null;
    }
    if (statusCode !== null && statusCode >= 200 && statusCode < 300) {
      await this.handle.db
        .updateTable('form_webhook_deliveries')
        .set({
          status: 'delivered',
          attempts: row.attempts + 1,
          lastStatusCode: statusCode,
          nextRetryAt: null,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('id', '=', row.id)
        .execute();
      this.logger.log({ msg: 'webhook delivered', deliveryId: row.id, statusCode });
      return;
    }
    await this.persistFailure(row, statusCode);
  }

  /**
   * Admin "Send test payload" (AC10): a schema-valid dummy payload POSTed to
   * the form's webhook URL with a 5s timeout. Returns the response status
   * code (null when unreachable). The body is never logged.
   */
  async sendTest(merchantId: string, formId: string): Promise<{ statusCode: number | null }> {
    const form = await this.handle.db
      .selectFrom('forms')
      .selectAll()
      .where('id', '=', formId)
      .where('merchantId', '=', merchantId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (!form) {
      throw new NotFoundException({ message: 'form not found', error_code: 'FORM_NOT_FOUND' });
    }
    if (!form.webhookUrl) {
      throw new BadRequestException({
        message: 'this form has no webhook URL configured',
        error_code: 'WEBHOOK_URL_MISSING',
      });
    }
    const payload = WebhookDeliveryService.buildTestPayload(form);
    try {
      const res = await this.post(form.webhookUrl, payload, TEST_TIMEOUT_MS);
      return { statusCode: res.status };
    } catch {
      return { statusCode: null };
    }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async persistFailure(
    row: FormWebhookDeliveryRow,
    statusCode: number | null,
  ): Promise<void> {
    const attempts = row.attempts + 1;
    if (attempts >= FORMS_WEBHOOK_MAX_ATTEMPTS) {
      await this.handle.db
        .updateTable('form_webhook_deliveries')
        .set({
          status: 'failed',
          attempts,
          lastStatusCode: statusCode,
          nextRetryAt: null,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('id', '=', row.id)
        .execute();
      this.logger.warn({
        msg: 'webhook delivery failed permanently',
        deliveryId: row.id,
        attempts,
        statusCode,
      });
      return;
    }
    // Index = attempts already made BEFORE this failure (row.attempts):
    // 1st failure → +5m, 2nd → +20m (TDD AC10).
    const delayMs =
      FORMS_WEBHOOK_RETRY_DELAYS_MS[row.attempts] ??
      FORMS_WEBHOOK_RETRY_DELAYS_MS[FORMS_WEBHOOK_RETRY_DELAYS_MS.length - 1] ??
      0;
    await this.handle.db
      .updateTable('form_webhook_deliveries')
      .set({
        status: 'pending',
        attempts,
        lastStatusCode: statusCode,
        nextRetryAt: new Date(Date.now() + delayMs),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', row.id)
      .execute();
    this.logger.warn({
      msg: 'webhook delivery attempt failed — retry scheduled',
      deliveryId: row.id,
      attempts,
      statusCode,
      retryInMs: delayMs,
    });
  }

  /** The documented `form.submitted` contract; file fields → 7-day URLs. */
  private async buildPayload(row: FormWebhookDeliveryRow): Promise<FormSubmittedPayload | null> {
    const submission = await this.handle.db
      .selectFrom('form_submissions')
      .selectAll()
      .where('id', '=', row.submissionId)
      .limit(1)
      .executeTakeFirst();
    if (!submission) return null;
    const form = await this.handle.db
      .selectFrom('forms')
      .select(['name'])
      .where('id', '=', row.formId)
      .limit(1)
      .executeTakeFirst();
    if (!form) return null;

    const data = WebhookDeliveryService.parseJson<Record<string, unknown>>(submission.dataJson);
    const files = WebhookDeliveryService.parseJson<Record<string, string>>(submission.filesJson);
    const fields: Record<string, unknown> = { ...(data ?? {}) };
    for (const [fieldKey, objectKey] of Object.entries(files ?? {})) {
      fields[fieldKey] = await this.s3.signedGetUrl(objectKey);
    }
    return {
      event: FORM_SUBMITTED_EVENT,
      merchant_id: row.merchantId,
      form_id: row.formId,
      form_name: form.name,
      submitted_at: new Date(submission.createdAt).toISOString(),
      submission_id: submission.id,
      schema_version: FORM_SUBMITTED_SCHEMA_VERSION,
      fields,
    };
  }

  private static buildTestPayload(form: FormRow): FormSubmittedPayload {
    const schema: FormField[] =
      typeof form.schemaJson === 'string'
        ? (JSON.parse(form.schemaJson) as FormField[])
        : form.schemaJson;
    const fields: Record<string, unknown> = {};
    for (const field of schema) {
      fields[field.key] = WebhookDeliveryService.sampleValue(field);
    }
    return {
      event: FORM_SUBMITTED_EVENT,
      merchant_id: form.merchantId,
      form_id: form.id,
      form_name: form.name,
      submitted_at: new Date().toISOString(),
      submission_id: `sub_test_${randomBytes(6).toString('base64url')}`,
      schema_version: FORM_SUBMITTED_SCHEMA_VERSION,
      fields,
    };
  }

  private static sampleValue(field: FormField): unknown {
    switch (field.type) {
      case 'email':
        return 'test@example.com';
      case 'phone':
        return '+919876543210';
      case 'dropdown':
        return field.options[0];
      case 'multi_select':
        return field.options.slice(0, 1);
      case 'date':
        return '2026-01-01';
      case 'file':
        return 'https://example.com/test-file.pdf';
      default:
        return `Test ${field.label}`;
    }
  }

  private async post(
    url: string,
    payload: FormSubmittedPayload,
    timeoutMs: number,
  ): Promise<{ status: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private static parseJson<T>(value: T | string | null): T | null {
    if (value === null) return null;
    return typeof value === 'string' ? (JSON.parse(value) as T) : value;
  }
}
