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

/** Claim lease: pushes an enqueued row's `next_retry_at` out so a double-fired cron can't re-claim it; re-surfaces after the lease if the worker died (at-least-once). */
// INVARIANT: lease MS >= worker SQS visibility (+ processing headroom); else the sweeper could re-claim a row still in-flight in a worker → double POST. Enforced in the constructor against FORMS_{WEBHOOK,EMAIL}_VISIBILITY.
export const FORMS_SWEEP_CLAIM_LEASE_MS = 2 * 60_000;

/** Minute cron (TRD §1): DB is the scheduler — claims due pending rows and enqueues to SQS; skips kill-switched merchants (AC11), caps per-merchant fan-out, idempotent under double-fire. */
@Injectable()
export class DeliverySweeperService {
  private readonly logger = new Logger(DeliverySweeperService.name);
  private running = false;

  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly queue: QueueService,
  ) {
    // Fail loud at boot if a worker's visibility was bumped past the claim lease
    // (see FORMS_SWEEP_CLAIM_LEASE_MS invariant) — silent double-POST otherwise.
    const maxVisibilityMs =
      Math.max(
        Number(process.env.FORMS_WEBHOOK_VISIBILITY ?? 120),
        Number(process.env.FORMS_EMAIL_VISIBILITY ?? 120),
      ) * 1_000;
    if (FORMS_SWEEP_CLAIM_LEASE_MS < maxVisibilityMs) {
      throw new Error(
        `FORMS_SWEEP_CLAIM_LEASE_MS (${FORMS_SWEEP_CLAIM_LEASE_MS}ms) must be >= worker visibility (${maxVisibilityMs}ms) to avoid re-enqueueing in-flight deliveries`,
      );
    }
  }

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

  /** Filter (kill switch, per-merchant cap) then claim each row; only rows whose conditional claim landed are enqueued. */
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

  /** Conditional-UPDATE claim: pushes `next_retry_at` out IFF still due+pending; rows-affected 0 ⇒ already claimed, skip (idempotency, TDD §3.7). */
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
