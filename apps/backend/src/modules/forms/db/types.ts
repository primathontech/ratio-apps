import type { FormAppearance, FormField } from '@ratio-app/shared/schemas/form-schema';
import type { ColumnType, Generated, Selectable } from 'kysely';
import type { BaseMerchantsTable } from '../../../core/merchants/merchant.types';
import type { BaseOauthTokensTable } from '../../../core/oauth/oauth-tokens.types';
import type { BaseWebhookLogTable } from '../../../core/webhooks/webhook-log.types';

/**
 * Kysely table types for the forms_app database — kept in lockstep with
 * `migrations/0001_initial.ts` (the migration smoke test asserts the table
 * list; the typechecker enforces the column shapes at every call site).
 *
 * Conventions:
 * - JSON columns are written with explicit `JSON.stringify` (mysql2 does not
 *   auto-serialize) and may come back as parsed objects OR strings — readers
 *   go through a parse helper.
 * - DECIMAL columns come back from mysql2 as strings — coerce with Number().
 * - BOOLEAN is TINYINT(1) — mysql2 returns 0/1, coerce with Boolean().
 */

interface FormsConfigsTable {
  merchantId: string;
  recaptchaSiteKey: Generated<string | null>;
  /** AES-256-GCM ciphertext of the merchant's reCAPTCHA secret (write-only). */
  recaptchaSecretEnc: Generated<string | null>;
  /** DECIMAL(3,2), default 0.30. */
  recaptchaThreshold: ColumnType<number | string, number | string | undefined, number | string>;
  defaultNotificationEmail: Generated<string | null>;
  /** Set by the email worker when the default recipient bounces. */
  emailBounced: Generated<boolean>;
  /** Per-merchant kill switch. */
  formsEnabled: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type FormSpamProtection = 'recaptcha' | 'honeypot';
export type FormStatus = 'active' | 'inactive';

interface FormsTable {
  /** `form_<random>` — minted by FormsService. */
  id: string;
  merchantId: string;
  name: string;
  /** Optional subtitle/heading (shared `formInputSchema.description`); null when unset. */
  description: Generated<string | null>;
  /** Ordered field array (shared `formFieldsSchema`); stringified on write. */
  schemaJson: ColumnType<FormField[] | string, string, string>;
  /** Optional theme (shared `appearanceSchema`); stringified on write, null when un-themed. */
  appearanceJson: ColumnType<FormAppearance | string | null, string | null, string | null>;
  submitLabel: string;
  successMessage: string;
  spamProtection: Generated<FormSpamProtection>;
  notificationEmail: Generated<string | null>;
  webhookUrl: Generated<string | null>;
  /** Optional https redirect-on-submit target (shared `formInputSchema.redirectUrl`). */
  redirectUrl: Generated<string | null>;
  status: Generated<FormStatus>;
  /** Soft delete only — submissions outlive the form. */
  deletedAt: Generated<Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

interface FormSubmissionsTable {
  /** `sub_<random>`. */
  id: string;
  formId: string;
  merchantId: string;
  /** Field key → submitted value map; stringified on write. */
  dataJson: ColumnType<Record<string, unknown> | string, string, string>;
  /** Field key → S3 object key (file fields only); stringified on write. */
  filesJson: ColumnType<
    Record<string, string> | string | null,
    string | null | undefined,
    string | null
  >;
  /** DECIMAL(3,2); null in honeypot mode. */
  recaptchaScore: ColumnType<
    number | string | null,
    number | string | null | undefined,
    number | string | null
  >;
  /** sha256(form + session + 5s bucket) — UNIQUE, the dedup mechanism. */
  idempotencyKey: string;
  createdAt: Generated<Date>;
}

export type FormWebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

interface FormWebhookDeliveriesTable {
  id: Generated<number>;
  submissionId: string;
  formId: string;
  merchantId: string;
  /** The endpoint at enqueue time (form.webhook_url snapshot). */
  url: string;
  status: Generated<FormWebhookDeliveryStatus>;
  attempts: Generated<number>;
  lastStatusCode: Generated<number | null>;
  nextRetryAt: Generated<Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type FormEmailLogStatus = 'pending' | 'sent' | 'failed' | 'bounced';

interface FormEmailLogTable {
  id: Generated<number>;
  submissionId: string;
  merchantId: string;
  recipient: string;
  status: Generated<FormEmailLogStatus>;
  attempts: Generated<number>;
  nextRetryAt: Generated<Date | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type FormExportJobStatus = 'pending' | 'processing' | 'ready' | 'failed';

/** Async CSV export jobs — kept in lockstep with `0002_export_jobs.ts`. */
interface FormExportJobsTable {
  /** `exp_<random base64url>` — minted by ExportJobService. */
  id: string;
  formId: string;
  merchantId: string;
  status: Generated<FormExportJobStatus>;
  /** S3 object key of the finished CSV; null until the worker uploads it. */
  s3Key: Generated<string | null>;
  /** Data rows exported (header excluded); null until ready. */
  rowCount: Generated<number | null>;
  /** Short failure message (never PII); null unless status = failed. */
  error: Generated<string | null>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface FormsDatabase {
  merchants: BaseMerchantsTable;
  oauth_tokens: BaseOauthTokensTable;
  webhook_log: BaseWebhookLogTable;
  forms_configs: FormsConfigsTable;
  forms: FormsTable;
  form_submissions: FormSubmissionsTable;
  form_webhook_deliveries: FormWebhookDeliveriesTable;
  form_email_log: FormEmailLogTable;
  form_export_jobs: FormExportJobsTable;
}

export type FormsMerchantRow = Selectable<BaseMerchantsTable>;
export type FormsConfigRow = Selectable<FormsConfigsTable>;
export type FormRow = Selectable<FormsTable>;
export type FormSubmissionRow = Selectable<FormSubmissionsTable>;
export type FormWebhookDeliveryRow = Selectable<FormWebhookDeliveriesTable>;
export type FormEmailLogRow = Selectable<FormEmailLogTable>;
export type FormExportJobRow = Selectable<FormExportJobsTable>;
