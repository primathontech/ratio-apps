import { randomBytes } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sanitizeFieldCss } from '@ratio-app/shared/schemas/custom-css';
import {
  HIDDEN_DEFAULT_SOURCE,
  type SubmissionContext,
} from '@ratio-app/shared/schemas/fields/hidden/constants';
import type { FormAppearance, FormField } from '@ratio-app/shared/schemas/form-schema';
import { type Kysely, sql } from 'kysely';
import { parseJsonColumn, parseJsonColumnOrNull } from '../../../core/db/json';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type {
  FormRow,
  FormSubmissionRow,
  FormsConfigRow,
  FormsDatabase,
  FormWebhookDeliveryRow,
} from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FormsRecaptchaService } from '../spam/recaptcha.service';
import { SubmitRateLimitService } from '../spam/submit-rate-limit.service';
import { FormsS3Service } from '../uploads/s3.service';
import { IdempotencyService } from './idempotency.service';
import { SchemaValidatorService } from './schema-validator.service';

export interface PublicSubmissionInput {
  fields: Record<string, unknown>;
  /** field key → S3 object key, or an array of keys for a multi-file field. */
  files?: Record<string, string | string[]> | undefined;
  /** SDK-minted session id (idempotency scope; controller may pass it via meta). */
  sessionId?: string | undefined;
  recaptchaToken?: string | undefined;
  _hp?: string | undefined;
}

export interface PublicSubmissionMeta {
  ip: string;
  /** `x-forms-session` header when the SDK sends one; falls back to IP. */
  sessionKey?: string;
}

export interface PublicSubmissionResult {
  submissionId: string;
}

/** The redacted render schema the public GET serves to the SDK. */
export interface PublicFormSchema {
  id: string;
  name: string;
  /** Optional subtitle/heading the widget renders under the form name. */
  description?: string;
  schema: FormField[];
  appearance?: FormAppearance;
  submitLabel: string;
  successMessage: string;
  /** Optional https redirect-on-submit target the widget navigates to on success. */
  redirectUrl?: string;
  spamProtection: 'recaptcha' | 'honeypot';
  recaptchaSiteKey?: string;
}

export interface SubmissionListItem {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  /** field key → object key (single-file) or object key array (multi-file). */
  files: Record<string, string | string[]>;
  recaptchaScore: number | null;
  createdAt: Date;
}

export interface SubmissionListResult {
  submissions: SubmissionListItem[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SubmissionDetail extends SubmissionListItem {
  /** field key → 7-day signed GET URL(s), shape mirrors `files`. */
  fileUrls: Record<string, string | string[]>;
  /** Hidden-field provenance captured at submit time (§4, `context_json`); empty when no hidden fields. */
  context: SubmissionContext;
}

/** The parts of the loaded form+config public flows need downstream. */
export interface ActiveFormContext {
  form: FormRow;
  config: FormsConfigRow;
  schema: FormField[];
}

/** Submission intake + admin reads (TRD §2); `submitPublic` runs the guard chain in order and each layer short-circuits (AC6). PII: field values never reach a log line. */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);
  /** In-memory metric of silently-rejected spam per form (PRD F7). */
  private readonly rejectedCounters = new Map<string, number>();

  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly rateLimit: SubmitRateLimitService,
    private readonly recaptcha: FormsRecaptchaService,
    private readonly validator: SchemaValidatorService,
    private readonly idempotency: IdempotencyService,
    private readonly s3: FormsS3Service,
  ) {}

  async submitPublic(
    formId: string,
    input: PublicSubmissionInput,
    meta: PublicSubmissionMeta,
  ): Promise<PublicSubmissionResult> {
    // (1) app-level business rate limit — 5 per 10 min per (form, IP).
    if (!(await this.rateLimit.allow(formId, meta.ip))) {
      throw new HttpException(
        {
          message: 'too many submissions — try again later',
          error_code: 'RATE_LIMITED',
        },
        429,
      );
    }

    // (2) form state + merchant kill switch.
    const ctx = await this.loadActiveForm(formId);

    // (3) spam check per the form's configured mode.
    let recaptchaScore: number | null = null;
    if (ctx.form.spamProtection === 'recaptcha') {
      const result = await this.recaptcha.verify(input.recaptchaToken, {
        recaptchaSecretEnc: ctx.config.recaptchaSecretEnc,
        recaptchaThreshold: ctx.config.recaptchaThreshold,
      });
      if (result.verdict === 'reject') {
        return this.silentReject(formId);
      }
      if (result.verdict === 'unavailable') {
        // reCAPTCHA unreachable → honeypot-only fallback (PRD F8).
        if (this.honeypotTripped(input)) return this.silentReject(formId);
      } else {
        recaptchaScore = result.score ?? null;
      }
    } else if (this.honeypotTripped(input)) {
      return this.silentReject(formId);
    }

    // (4) server-side schema validation → 422 with per-field errors.
    const validated = this.validator.validate(ctx.schema, input.fields, input.files, {
      merchantId: ctx.form.merchantId,
      formId: ctx.form.id,
    });
    if (!validated.ok) {
      throw new UnprocessableEntityException({
        message: 'submission validation failed',
        error_code: 'SUBMISSION_INVALID',
        details: { fields: validated.errors },
        safeForClient: true,
      });
    }

    // (4b) HEAD each accepted file: key segments are public, so a fabricated key would store a phantom reference (P2-2).
    for (const [fieldKey, value] of Object.entries(validated.files)) {
      for (const objectKey of Array.isArray(value) ? value : [value]) {
        if (!(await this.s3.exists(objectKey))) {
          throw new UnprocessableEntityException({
            message: 'submission validation failed',
            error_code: 'SUBMISSION_INVALID',
            details: { fields: { [fieldKey]: 'uploaded file not found' } },
            safeForClient: true,
          });
        }
      }
    }

    // (5) idempotency key: sha256(formId : session-or-ip : 5s bucket).
    const idempotencyKey = this.idempotency.computeKey(formId, meta.sessionKey ?? meta.ip);

    // (6) insert + enqueue in ONE transaction so a stored-but-undeliverable submission can't 409 its own retry forever (P3-1).
    const submissionId = SubmissionsService.mintSubmissionId();
    const hasFiles = Object.keys(validated.files).length > 0;
    const context = SubmissionsService.buildContext(ctx.schema, validated.data);
    const hasContext = Object.keys(context).length > 0;
    try {
      await this.handle.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('form_submissions')
          .values({
            id: submissionId,
            formId: ctx.form.id,
            merchantId: ctx.form.merchantId,
            dataJson: JSON.stringify(validated.data),
            filesJson: hasFiles ? JSON.stringify(validated.files) : null,
            contextJson: hasContext ? JSON.stringify(context) : null,
            recaptchaScore,
            idempotencyKey,
          })
          .execute();
        await this.enqueueDeliveries(trx, ctx, submissionId);
      });
    } catch (err) {
      if (this.idempotency.isDuplicateKeyError(err)) {
        // Duplicate (form, session-or-ip, 5s bucket) → 409, returning the original id so a client that lost the first response can reconcile (PRD F10 / P3-2).
        const originalId = await this.findSubmissionIdByKey(ctx.form.merchantId, idempotencyKey);
        throw new HttpException(
          {
            message: 'duplicate submission — already received',
            error_code: 'duplicate_submission',
            ...(originalId ? { submissionId: originalId } : {}),
          },
          409,
        );
      }
      throw err;
    }

    return { submissionId };
  }

  /** Public render schema for the SDK — strips emails/webhook URL/secrets. */
  async getPublicSchema(formId: string): Promise<PublicFormSchema> {
    const form = await this.handle.db
      .selectFrom('forms')
      .selectAll()
      .where('id', '=', formId)
      .limit(1)
      .executeTakeFirst();
    // Deleted and never-existed are indistinguishable to the storefront (AC4).
    if (!form || form.deletedAt) {
      throw new NotFoundException({
        message: 'this form is no longer available',
        error_code: 'form_not_available',
      });
    }
    const config = await this.loadConfig(form.merchantId);
    if (!config?.formsEnabled) {
      throw new ForbiddenException({
        message: 'forms are currently unavailable for this store',
        error_code: 'form_unavailable',
      });
    }
    if (form.status !== 'active') {
      throw new ForbiddenException({
        message: 'this form is not accepting submissions',
        error_code: 'form_inactive',
      });
    }
    // Sanitize + field-scope merchant custom CSS on the read path so the widget only ever receives shadow-safe, scoped CSS.
    const schema = parseJsonColumn<FormField[]>(form.schemaJson).map((field) => {
      const raw = (field as { customCss?: string }).customCss;
      if (!raw) return field;
      const clean = sanitizeFieldCss(raw, `[data-field="${field.key}"]`).css;
      return { ...field, customCss: clean || undefined };
    });
    if (schema.length === 0) {
      // Misconfigured — an empty form must not render (PRD 10.10.6).
      throw new NotFoundException({
        message: 'this form is not available',
        error_code: 'form_not_available',
      });
    }
    const siteKey =
      form.spamProtection === 'recaptcha'
        ? (config.recaptchaSiteKey ?? process.env.FORMS_RECAPTCHA_SHARED_SITE_KEY?.trim() ?? null)
        : null;
    const appearance = parseJsonColumnOrNull<FormAppearance>(form.appearanceJson);
    return {
      id: form.id,
      name: form.name,
      ...(form.description ? { description: form.description } : {}),
      schema,
      ...(appearance ? { appearance } : {}),
      submitLabel: form.submitLabel,
      successMessage: form.successMessage,
      ...(form.redirectUrl ? { redirectUrl: form.redirectUrl } : {}),
      spamProtection: form.spamProtection,
      ...(siteKey ? { recaptchaSiteKey: siteKey } : {}),
    };
  }

  /** Shared form-state gate for public submit + upload: missing/deleted/kill-switched → 403 `form_unavailable`, not active → 403 `form_inactive`. */
  async loadActiveForm(formId: string): Promise<ActiveFormContext> {
    const form = await this.handle.db
      .selectFrom('forms')
      .selectAll()
      .where('id', '=', formId)
      .limit(1)
      .executeTakeFirst();
    if (!form || form.deletedAt) {
      throw new ForbiddenException({
        message: 'this form is not available',
        error_code: 'form_unavailable',
      });
    }
    const config = await this.loadConfig(form.merchantId);
    if (!config?.formsEnabled) {
      throw new ForbiddenException({
        message: 'forms are currently unavailable for this store',
        error_code: 'form_unavailable',
      });
    }
    if (form.status !== 'active') {
      throw new ForbiddenException({
        message: 'this form is not accepting submissions',
        error_code: 'form_inactive',
      });
    }
    return { form, config, schema: parseJsonColumn<FormField[]>(form.schemaJson) };
  }

  /** Observability hook for the silent-reject metric (PRD F7). */
  rejectedCount(formId: string): number {
    return this.rejectedCounters.get(formId) ?? 0;
  }

  async list(
    merchantId: string,
    formId: string,
    page = 1,
    limit = 20,
  ): Promise<SubmissionListResult> {
    await this.requireOwnForm(merchantId, formId);
    const offset = (page - 1) * limit;
    const rows = await this.handle.db
      .selectFrom('form_submissions')
      .selectAll()
      .where('formId', '=', formId)
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();
    return {
      submissions: rows.slice(0, limit).map((row) => this.toListItem(row)),
      page,
      limit,
      hasMore: rows.length > limit,
    };
  }

  async detail(merchantId: string, submissionId: string): Promise<SubmissionDetail> {
    const row = await this.handle.db
      .selectFrom('form_submissions')
      .selectAll()
      .where('id', '=', submissionId)
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({
        message: 'submission not found',
        error_code: 'SUBMISSION_NOT_FOUND',
      });
    }
    const item = this.toListItem(row);
    const fileUrls: Record<string, string | string[]> = {};
    for (const [fieldKey, value] of Object.entries(item.files)) {
      fileUrls[fieldKey] = Array.isArray(value)
        ? await Promise.all(value.map((key) => this.s3.signedGetUrl(key)))
        : await this.s3.signedGetUrl(value);
    }
    const context =
      parseJsonColumnOrNull<SubmissionContext>(row.contextJson) ?? ({} as SubmissionContext);
    return { ...item, fileUrls, context };
  }

  /** Delivery log for a form (webhook status view). */
  async deliveries(
    merchantId: string,
    formId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    deliveries: FormWebhookDeliveryRow[];
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    await this.requireOwnForm(merchantId, formId);
    const offset = (page - 1) * limit;
    const rows = await this.handle.db
      .selectFrom('form_webhook_deliveries')
      .selectAll()
      .where('formId', '=', formId)
      .where('merchantId', '=', merchantId)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();
    return { deliveries: rows.slice(0, limit), page, limit, hasMore: rows.length > limit };
  }

  /** Manual re-trigger: failed → pending with next_retry_at = now (AC10). */
  async retriggerDelivery(merchantId: string, deliveryId: number): Promise<{ status: string }> {
    const result = await this.handle.db
      .updateTable('form_webhook_deliveries')
      .set({
        status: 'pending',
        nextRetryAt: new Date(),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', deliveryId)
      .where('merchantId', '=', merchantId)
      .where('status', '=', 'failed')
      .executeTakeFirst();
    if (Number(result?.numUpdatedRows ?? 0) === 0) {
      // Cross-merchant, missing, or not `failed` — indistinguishable 404.
      throw new NotFoundException({
        message: 'failed delivery not found',
        error_code: 'DELIVERY_NOT_FOUND',
      });
    }
    return { status: 'pending' };
  }

  /** Merchant-scoped form lookup that INCLUDES soft-deleted forms — submissions outlive the form (AC4/AC8). */
  async requireOwnForm(merchantId: string, formId: string): Promise<FormRow> {
    const form = await this.handle.db
      .selectFrom('forms')
      .selectAll()
      .where('id', '=', formId)
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
    if (!form) {
      throw new NotFoundException({ message: 'form not found', error_code: 'FORM_NOT_FOUND' });
    }
    return form;
  }

  private honeypotTripped(input: PublicSubmissionInput): boolean {
    return typeof input._hp === 'string' && input._hp.trim() !== '';
  }

  /** PRD F7: suspected bots get a 200 with a fake submission id — nothing stored or delivered, only a counter + id-free log line. */
  private silentReject(formId: string): PublicSubmissionResult {
    this.rejectedCounters.set(formId, (this.rejectedCounters.get(formId) ?? 0) + 1);
    this.logger.log({
      msg: 'submission silently rejected (spam)',
      formId,
      rejectedTotal: this.rejectedCounters.get(formId),
    });
    return { submissionId: SubmissionsService.mintSubmissionId() };
  }

  /** Email-log + webhook-delivery rows (minute sweeper drains them); runs on the caller's transaction so rows commit atomically with the submission (P3-1). */
  private async enqueueDeliveries(
    db: Kysely<FormsDatabase>,
    ctx: ActiveFormContext,
    submissionId: string,
  ): Promise<void> {
    const now = new Date();
    const recipient = ctx.form.notificationEmail ?? ctx.config.defaultNotificationEmail;
    if (recipient) {
      await db
        .insertInto('form_email_log')
        .values({
          submissionId,
          merchantId: ctx.form.merchantId,
          recipient,
          status: 'pending',
          nextRetryAt: now,
        })
        .execute();
    }
    if (ctx.form.webhookUrl) {
      await db
        .insertInto('form_webhook_deliveries')
        .values({
          submissionId,
          formId: ctx.form.id,
          merchantId: ctx.form.merchantId,
          url: ctx.form.webhookUrl,
          status: 'pending',
          nextRetryAt: now,
        })
        .execute();
    }
  }

  /** Original submission id for an idempotency key — recovers the id on a 409. */
  private async findSubmissionIdByKey(
    merchantId: string,
    idempotencyKey: string,
  ): Promise<string | null> {
    const row = await this.handle.db
      .selectFrom('form_submissions')
      .select('id')
      .where('merchantId', '=', merchantId)
      .where('idempotencyKey', '=', idempotencyKey)
      .limit(1)
      .executeTakeFirst();
    return row?.id ?? null;
  }

  private loadConfig(merchantId: string): Promise<FormsConfigRow | undefined> {
    return this.handle.db
      .selectFrom('forms_configs')
      .selectAll()
      .where('merchantId', '=', merchantId)
      .limit(1)
      .executeTakeFirst();
  }

  private toListItem(row: FormSubmissionRow): SubmissionListItem {
    return {
      id: row.id,
      formId: row.formId,
      data: parseJsonColumn<Record<string, unknown>>(row.dataJson),
      files: parseJsonColumnOrNull<Record<string, string | string[]>>(row.filesJson) ?? {},
      recaptchaScore: row.recaptchaScore === null ? null : Number(row.recaptchaScore),
      createdAt: row.createdAt,
    };
  }

  /** Hidden-field provenance (§4, `context_json`): source + raw value for each resolved hidden field; unset `source` defaults to `url_param`, mirroring the resolver. */
  private static buildContext(
    schema: FormField[],
    data: Record<string, unknown>,
  ): SubmissionContext {
    const context: SubmissionContext = {};
    for (const field of schema) {
      if (field.type !== 'hidden') continue;
      const value = data[field.key];
      if (value === undefined) continue;
      context[field.key] = {
        source: field.source ?? HIDDEN_DEFAULT_SOURCE,
        value: String(value),
      };
    }
    return context;
  }

  /** `sub_<random>` via node:crypto — also used for the fake spam-reject id. */
  private static mintSubmissionId(): string {
    return `sub_${randomBytes(12).toString('base64url')}`;
  }
}
