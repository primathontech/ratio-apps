import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FORMS_EMAIL_RETRY_DELAY_MS } from '@ratio-app/shared/constants/forms-events';
import { sql } from 'kysely';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormEmailLogRow, FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { createDefaultEmailClient, type EmailClientLike, FORMS_EMAIL_CLIENT } from './email.client';

// Re-exported so existing consumers/tests can keep importing from the executor.
export { type EmailClientLike, FORMS_EMAIL_CLIENT } from './email.client';

/** One retry, then failed (AC9): pending → sent | pending(+10m) → failed. */
export const FORMS_EMAIL_MAX_ATTEMPTS = 2;

const DEFAULT_FROM = 'noreply@ratio.store';

/**
 * The email notification EXECUTOR — one attempt per call, invoked by the
 * email worker for each queued `form_email_log` row.
 *
 * State machine: success → `sent`; first failure → `pending` with
 * next_retry_at = now + FORMS_EMAIL_RETRY_DELAY_MS (10 min); second failure
 * → `failed`. A provider bounce event lands through {@link markBounced}
 * (status `bounced` + the merchant-visible `email_bounced` config flag) —
 * the inbound bounce-webhook wiring is a later phase.
 *
 * Provider: injected via {@link FORMS_EMAIL_CLIENT} in tests; otherwise the
 * env-derived default from `email.client.ts` (SES when `FORMS_EMAIL_FROM` is
 * configured, a logged no-op otherwise).
 *
 * PII: submission values may appear in the EMAIL BODY (that is the feature)
 * but never in log lines.
 */
@Injectable()
export class FormsEmailService {
  private readonly logger = new Logger(FormsEmailService.name);
  private readonly client: EmailClientLike;

  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    @Optional() @Inject(FORMS_EMAIL_CLIENT) client?: EmailClientLike,
  ) {
    this.client = client ?? createDefaultEmailClient(this.logger);
  }

  /** One send attempt for a claimed row. Never throws (state → the row). */
  async execute(row: FormEmailLogRow): Promise<void> {
    const message = await this.composeMessage(row);
    try {
      await this.client.send(message);
    } catch {
      // Provider failure — never log the error object (it can echo the
      // message body, which carries submission values).
      await this.persistFailure(row);
      return;
    }
    await this.handle.db
      .updateTable('form_email_log')
      .set({
        status: 'sent',
        attempts: row.attempts + 1,
        nextRetryAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', row.id)
      .execute();
    this.logger.log({ msg: 'notification email sent', emailLogId: row.id });
  }

  /**
   * Bounce handling (AC9): flip this recipient's undelivered log rows to
   * `bounced` and raise the merchant-visible `email_bounced` config flag.
   * Called by the (future) inbound bounce webhook.
   */
  async markBounced(merchantId: string, recipient: string): Promise<void> {
    await this.handle.db
      .updateTable('form_email_log')
      .set({ status: 'bounced', nextRetryAt: null, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .where('recipient', '=', recipient)
      .where('status', 'in', ['pending', 'sent'])
      .execute();
    await this.handle.db
      .updateTable('forms_configs')
      .set({ emailBounced: true, updatedAt: sql`CURRENT_TIMESTAMP(3)` })
      .where('merchantId', '=', merchantId)
      .execute();
    this.logger.warn({ msg: 'notification recipient bounced', merchantId });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async persistFailure(row: FormEmailLogRow): Promise<void> {
    const attempts = row.attempts + 1;
    if (attempts >= FORMS_EMAIL_MAX_ATTEMPTS) {
      await this.handle.db
        .updateTable('form_email_log')
        .set({
          status: 'failed',
          attempts,
          nextRetryAt: null,
          updatedAt: sql`CURRENT_TIMESTAMP(3)`,
        })
        .where('id', '=', row.id)
        .execute();
      this.logger.warn({ msg: 'notification email failed permanently', emailLogId: row.id });
      return;
    }
    await this.handle.db
      .updateTable('form_email_log')
      .set({
        status: 'pending',
        attempts,
        nextRetryAt: new Date(Date.now() + FORMS_EMAIL_RETRY_DELAY_MS),
        updatedAt: sql`CURRENT_TIMESTAMP(3)`,
      })
      .where('id', '=', row.id)
      .execute();
    this.logger.warn({
      msg: 'notification email attempt failed — retry scheduled',
      emailLogId: row.id,
      attempts,
      retryInMs: FORMS_EMAIL_RETRY_DELAY_MS,
    });
  }

  /** Subject/body from the submission — plain text, values included. */
  private async composeMessage(row: FormEmailLogRow): Promise<{
    to: string;
    from: string;
    subject: string;
    text: string;
  }> {
    const from = process.env.FORMS_EMAIL_FROM?.trim() || DEFAULT_FROM;
    const submission = await this.handle.db
      .selectFrom('form_submissions')
      .selectAll()
      .where('id', '=', row.submissionId)
      .limit(1)
      .executeTakeFirst();
    const form = submission
      ? await this.handle.db
          .selectFrom('forms')
          .select(['name'])
          .where('id', '=', submission.formId)
          .limit(1)
          .executeTakeFirst()
      : undefined;
    const formName = form?.name ?? 'your form';
    const data = submission
      ? (FormsEmailService.parseJson<Record<string, unknown>>(submission.dataJson) ?? {})
      : {};
    const lines = Object.entries(data).map(
      ([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
    );
    return {
      to: row.recipient,
      from,
      subject: `New submission — ${formName}`,
      text: [
        `You received a new submission on "${formName}".`,
        '',
        ...lines,
        '',
        `Submission id: ${row.submissionId}`,
      ].join('\n'),
    };
  }

  private static parseJson<T>(value: T | string | null): T | null {
    if (value === null) return null;
    return typeof value === 'string' ? (JSON.parse(value) as T) : value;
  }
}
