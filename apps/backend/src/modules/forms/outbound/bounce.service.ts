import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { z } from 'zod';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';
import { FormsEmailService } from './email.service';
import { isAwsSnsUrl, type SnsMessage, verifySnsSignature } from './sns-signature';

/** Minimal fetch shape (cert download + subscription confirm) — injectable so tests script it without the network. */
export type SnsFetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** DI token for the fetch override (unset in prod → global fetch). */
export const FORMS_SNS_FETCH = Symbol.for('ratio-app:forms:sns-fetch');

/** Transport envelope (extra keys tolerated — SNS adds more we don't read). */
const snsEnvelopeSchema = z
  .object({
    Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
    MessageId: z.string().min(1),
    TopicArn: z.string().optional(),
    Subject: z.string().optional(),
    Message: z.string(),
    Timestamp: z.string(),
    SignatureVersion: z.string(),
    Signature: z.string().min(1),
    SigningCertURL: z.string().min(1),
    Token: z.string().optional(),
    SubscribeURL: z.string().optional(),
  })
  .passthrough();

/** SES bounce payload (the inner `Message` JSON) — only the fields we act on. */
const sesBounceSchema = z
  .object({
    notificationType: z.string(),
    bounce: z
      .object({
        bouncedRecipients: z.array(z.object({ emailAddress: z.string().min(1) })),
      })
      .optional(),
  })
  .passthrough();

/**
 * Inbound SES-over-SNS bounce handler (PRD AC9). Unauthenticated by nature (SNS
 * posts to it), so every request is gated by SNS signature verification:
 * validate the SigningCertURL is an AWS host, fetch the cert, verify the
 * signature over the canonical string. Auto-confirms `SubscriptionConfirmation`;
 * on a verified bounce `Notification` resolves the owning merchant(s) from the
 * email log and calls the existing `FormsEmailService.markBounced`.
 *
 * No-PII invariant: never logs the raw body, recipient addresses, or the payload.
 */
@Injectable()
export class FormsBounceService {
  private readonly logger = new Logger(FormsBounceService.name);
  private readonly fetchImpl: SnsFetchLike;
  private readonly certCache = new Map<string, string>();

  constructor(
    @Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>,
    private readonly email: FormsEmailService,
    @Optional() @Inject(FORMS_SNS_FETCH) fetchImpl?: SnsFetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as SnsFetchLike);
  }

  /** Verify then dispatch by Type. Always 200 on success; throws → 4xx envelope. */
  async ingest(input: unknown): Promise<{ ok: true }> {
    const msg = this.toEnvelope(input);
    await this.verify(msg);

    // Optional defense-in-depth: pin to a known topic when configured.
    const expectedTopic = process.env.FORMS_SNS_TOPIC_ARN?.trim();
    if (expectedTopic && msg.TopicArn !== expectedTopic) {
      throw new ForbiddenException({ error_code: 'SNS_TOPIC_MISMATCH' });
    }

    if (msg.Type === 'SubscriptionConfirmation') {
      await this.confirmSubscription(msg);
      return { ok: true };
    }
    if (msg.Type === 'Notification') {
      await this.processNotification(msg);
    }
    // UnsubscribeConfirmation (and anything else verified) is a no-op.
    return { ok: true };
  }

  private toEnvelope(input: unknown): SnsMessage {
    let json: unknown = input;
    if (typeof input === 'string' || Buffer.isBuffer(input)) {
      try {
        json = JSON.parse(input.toString());
      } catch {
        throw new BadRequestException({ error_code: 'SNS_BAD_JSON' });
      }
    }
    const parsed = snsEnvelopeSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestException({ error_code: 'SNS_BAD_ENVELOPE' });
    }
    return parsed.data as SnsMessage;
  }

  private async verify(msg: SnsMessage): Promise<void> {
    if (!isAwsSnsUrl(msg.SigningCertURL)) {
      throw new ForbiddenException({ error_code: 'SNS_BAD_CERT_URL' });
    }
    const cert = await this.fetchCert(msg.SigningCertURL);
    if (!verifySnsSignature(msg, cert)) {
      throw new ForbiddenException({ error_code: 'SNS_BAD_SIGNATURE' });
    }
  }

  private async fetchCert(url: string): Promise<string> {
    const cached = this.certCache.get(url);
    if (cached) return cached;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new ForbiddenException({ error_code: 'SNS_CERT_FETCH_FAILED' });
    const pem = await res.text();
    this.certCache.set(url, pem);
    return pem;
  }

  /** SNS confirms a subscription when we GET the (AWS-host) SubscribeURL. */
  private async confirmSubscription(msg: SnsMessage): Promise<void> {
    if (!msg.SubscribeURL || !isAwsSnsUrl(msg.SubscribeURL)) {
      throw new ForbiddenException({ error_code: 'SNS_BAD_SUBSCRIBE_URL' });
    }
    await this.fetchImpl(msg.SubscribeURL);
    this.logger.log({ msg: 'SNS subscription confirmed' });
  }

  private async processNotification(msg: SnsMessage): Promise<void> {
    let inner: unknown;
    try {
      inner = JSON.parse(msg.Message);
    } catch {
      return; // Not an SES payload we understand — ack (200) and drop.
    }
    const parsed = sesBounceSchema.safeParse(inner);
    if (!parsed.success || parsed.data.notificationType !== 'Bounce') return;

    const recipients = [
      ...new Set(
        (parsed.data.bounce?.bouncedRecipients ?? [])
          .map((r) => r.emailAddress.trim())
          .filter((a) => a.length > 0),
      ),
    ];
    for (const recipient of recipients) {
      await this.markBouncedForRecipient(recipient);
    }
    this.logger.warn({ msg: 'ses bounce processed', recipients: recipients.length });
  }

  /**
   * Merchant resolution: the email log is the authoritative record of which
   * merchant we emailed at an address, so resolve the owning merchant(s) from
   * `form_email_log` (a shared recipient can serve several merchants) and flip
   * each via the existing markBounced.
   */
  private async markBouncedForRecipient(recipient: string): Promise<void> {
    const rows = await this.handle.db
      .selectFrom('form_email_log')
      .select(['merchantId'])
      .where('recipient', '=', recipient)
      .execute();
    const merchantIds = [...new Set(rows.map((r) => r.merchantId))];
    for (const merchantId of merchantIds) {
      await this.email.markBounced(merchantId, recipient);
    }
  }
}
