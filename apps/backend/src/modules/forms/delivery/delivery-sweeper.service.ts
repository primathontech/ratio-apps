import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { type EmailNotificationMessage, formsEmailQueueName } from './email-notification.queue';
import { formsWebhookQueueName, type WebhookDeliveryMessage } from './webhook-delivery.queue';

/** Webhook fan-out cap: ≤ 100 deliveries per merchant per sweep (per minute). */
export const FORMS_SWEEP_MERCHANT_BATCH_CAP = 100;

/** How many due rows one sweep considers overall (bounds the scan). */
const SWEEP_SCAN_LIMIT = 1_000;

/**
 * Claim lease: a claimed row's `next_retry_at` is pushed this far into the
 * future the moment it is enqueued, so a double-fired cron (overlapping pod,
 * re-run) cannot claim — and re-enqueue — the same row again while the
 * worker processes it. The worker overwrites it with the real schedule (or
 * clears it) when the attempt settles; if the worker dies mid-flight the
 * row surfaces as due again after the lease and is re-swept (at-least-once).
 */
export const FORMS_SWEEP_CLAIM_LEASE_MS = 2 * 60_000;

/**
 * The minute cron that drives both delivery state machines (TRD §1): the DB
 * is the SCHEDULER. Due `pending` rows (`next_retry_at <= now`) are CLAIMED
 * via a conditional UPDATE and enqueued to SQS — `{ deliveryId }` to the
 * webhook queue, `{ emailLogId }` to the email queue; the self-gated workers
 * drain the queues and write outcomes back to the rows.
 *
 * - Self-gating (google reconcile-cron precedent): webhooks sweep only when
 *   `FORMS_WEBHOOK_WORKER_ENABLED === 'true'`; emails only when
 *   `FORMS_EMAIL_WORKER_ENABLED === 'true'` — the sweeper runs in the same
 *   process as its workers, so the flags gate the whole pipeline.
 * - Kill switch: merchants with `forms_enabled = false` are skipped — their
 *   rows stay `pending` and drain on re-enable (AC11).
 * - Fan-out cap: ≤ {@link FORMS_SWEEP_MERCHANT_BATCH_CAP} rows per merchant
 *   per sweep (PRD watch-out: ≤100/min per merchant).
 * - Idempotent under double-fire: the conditional-UPDATE claim (checked by
 *   rows-affected) plus the {@link FORMS_SWEEP_CLAIM_LEASE_MS} visibility
 *   guard mean a row is enqueued at most once per due window — plus an
 *   in-process overlap flag like google's reconcile cron.
 */
@Injectable()
export class DeliverySweeperService {
  private readonly logger = new Logger(DeliverySweeperService.name);
  private running = false;

  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly queue: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    await this.sweepOnce();
  }

  /** One sweep pass. Exposed for deterministic tests. */
  async sweepOnce(): Promise<{ webhooks: number; emails: number }> {
    const webhooksEnabled = process.env.FORMS_WEBHOOK_WORKER_ENABLED === 'true';
    const emailsEnabled = process.env.FORMS_EMAIL_WORKER_ENABLED === 'true';
    if (!webhooksEnabled && !emailsEnabled) {
      return { webhooks: 0, emails: 0 };
    }
    if (this.running) {
      this.logger.warn({ msg: 'delivery sweep already running — skipping overlapping cycle' });
      return { webhooks: 0, emails: 0 };
    }
    this.running = true;
    try {
      const paused = await this.pausedMerchants();
      const webhooks = webhooksEnabled ? await this.sweepWebhooks(paused) : 0;
      const emails = emailsEnabled ? await this.sweepEmails(paused) : 0;
      if (webhooks > 0 || emails > 0) {
        this.logger.log({ msg: 'delivery sweep enqueued', webhooks, emails });
      }
      return { webhooks, emails };
    } finally {
      this.running = false;
    }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Kill-switched merchants — their rows wait (and drain on re-enable). */
  private async pausedMerchants(): Promise<Set<string>> {
    const rows = await this.handle.db
      .selectFrom('forms_configs')
      .select(['merchantId'])
      .where('formsEnabled', '=', false)
      .execute();
    return new Set(rows.map((r) => r.merchantId));
  }

  private async sweepWebhooks(paused: Set<string>): Promise<number> {
    const now = new Date();
    const due = await this.handle.db
      .selectFrom('form_webhook_deliveries')
      .select(['id', 'merchantId'])
      .where('status', '=', 'pending')
      .where('nextRetryAt', '<=', now)
      .orderBy('nextRetryAt', 'asc')
      .limit(SWEEP_SCAN_LIMIT)
      .execute();

    const claimed = await this.claimEligible('form_webhook_deliveries', due, paused, now);
    if (claimed.length > 0) {
      const messages: WebhookDeliveryMessage[] = claimed.map((deliveryId) => ({ deliveryId }));
      await this.queue.sendBatch(formsWebhookQueueName(), messages);
    }
    return claimed.length;
  }

  private async sweepEmails(paused: Set<string>): Promise<number> {
    const now = new Date();
    const due = await this.handle.db
      .selectFrom('form_email_log')
      .select(['id', 'merchantId'])
      .where('status', '=', 'pending')
      .where('nextRetryAt', '<=', now)
      .orderBy('nextRetryAt', 'asc')
      .limit(SWEEP_SCAN_LIMIT)
      .execute();

    const claimed = await this.claimEligible('form_email_log', due, paused, now);
    if (claimed.length > 0) {
      const messages: EmailNotificationMessage[] = claimed.map((emailLogId) => ({ emailLogId }));
      await this.queue.sendBatch(formsEmailQueueName(), messages);
    }
    return claimed.length;
  }

  /**
   * Filter (kill switch, per-merchant cap) then claim each row. Only rows
   * whose conditional claim actually landed are enqueued.
   */
  private async claimEligible(
    table: 'form_webhook_deliveries' | 'form_email_log',
    due: Array<{ id: number; merchantId: string }>,
    paused: Set<string>,
    now: Date,
  ): Promise<number[]> {
    const perMerchant = new Map<string, number>();
    const claimed: number[] = [];
    for (const row of due) {
      if (paused.has(row.merchantId)) continue;
      const count = perMerchant.get(row.merchantId) ?? 0;
      if (count >= FORMS_SWEEP_MERCHANT_BATCH_CAP) continue;
      if (!(await this.claim(table, row.id, now))) continue;
      perMerchant.set(row.merchantId, count + 1);
      claimed.push(row.id);
    }
    return claimed;
  }

  /**
   * Conditional-UPDATE claim: pushes `next_retry_at` out by the lease window
   * IFF the row is still due and pending. rows-affected 0 ⇒ another sweeper
   * (or a re-fired cron) already claimed it — skip (idempotency, TDD §3.7).
   */
  private async claim(
    table: 'form_webhook_deliveries' | 'form_email_log',
    id: number,
    now: Date,
  ): Promise<boolean> {
    const result = await this.handle.db
      .updateTable(table)
      .set({ nextRetryAt: new Date(now.getTime() + FORMS_SWEEP_CLAIM_LEASE_MS) })
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .where('nextRetryAt', '<=', now)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }
}
