import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import { QueueService } from '../../../core/queue/queue.service';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FormsEmailService } from './email.service';
import { type EmailNotificationMessage, formsEmailQueueName } from './email-notification.queue';

/**
 * Drains the forms email-notification SQS queue: self-gated by
 * `FORMS_EMAIL_WORKER_ENABLED`, long-polls via the core `QueueService`,
 * loads each message's `form_email_log` row, and hands it to
 * {@link FormsEmailService.execute} — the executor owns the retry state
 * machine (sent | pending +10m | failed) and never throws.
 *
 * Same idempotency shape as the webhook worker: outcomes live in the DB
 * row, redelivered messages for settled rows are skipped and acked.
 *
 * PII: recipient addresses and submission values never reach log lines.
 */
@Injectable()
export class FormsEmailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FormsEmailWorker.name);
  private running = false;

  private readonly VISIBILITY = Number(process.env.FORMS_EMAIL_VISIBILITY ?? 120);

  constructor(
    private readonly queue: QueueService,
    private readonly executor: FormsEmailService,
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
  ) {}

  onModuleInit(): void {
    if (process.env.FORMS_EMAIL_WORKER_ENABLED !== 'true') {
      this.logger.log('forms email worker disabled (FORMS_EMAIL_WORKER_ENABLED!=true)');
      return;
    }
    this.running = true;
    this.logger.log({ msg: 'forms email worker started', visibility: this.VISIBILITY });
    void this.loop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (err) {
        this.logger.error({ msg: 'forms email worker loop error', err: `${err}` });
        await this.sleep(1000);
      }
    }
  }

  /** Receive one batch (≤10) and attempt each send. Exposed for deterministic tests. */
  async drainOnce(): Promise<void> {
    const queueName = formsEmailQueueName();
    const msgs = await this.queue.receive<EmailNotificationMessage>(
      queueName,
      10,
      5,
      this.VISIBILITY,
    );
    for (const m of msgs) {
      try {
        await this.process(m.body);
        await this.queue.ack(queueName, [m.receiptHandle]);
      } catch (err) {
        this.logger.error({
          msg: 'forms email message failed (will retry)',
          emailLogId: m.body?.emailLogId,
          err: `${err}`,
        });
      }
    }
  }

  private async process(msg: EmailNotificationMessage): Promise<void> {
    const row = await this.handle.db
      .selectFrom('form_email_log')
      .selectAll()
      .where('id', '=', msg.emailLogId)
      .limit(1)
      .executeTakeFirst();
    if (!row) {
      this.logger.warn({ msg: 'email log row vanished — dropping', id: msg.emailLogId });
      return;
    }
    if (row.status !== 'pending') {
      // Already settled (double-fire / redelivery) — skip.
      return;
    }
    await this.executor.execute(row);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
