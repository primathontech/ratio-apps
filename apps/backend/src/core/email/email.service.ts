import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal SES email sender for transactional notifications (e.g. "your export
 * is ready" links). Vendor-agnostic core infra shared across modules.
 *
 * Enabled only when `EMAIL_FROM` is set (a verified SES identity, owned by
 * DevOps per environment). Without it every send is a logged no-op — a dev
 * machine or a deployment without SES never breaks a caller.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESv2Client | null;
  private readonly from: string | undefined;

  constructor() {
    this.from = process.env.EMAIL_FROM || undefined;
    this.client = this.from
      ? new SESv2Client({ region: process.env.AWS_REGION ?? 'ap-south-1' })
      : null;
    if (!this.from) {
      this.logger.warn('EMAIL_FROM not set — email sending disabled (no-op)');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Send one email. Returns true when actually sent, false on the disabled
   * no-op path. Upstream failures THROW — callers decide whether an email is
   * best-effort or must retry (e.g. an un-acked queue message).
   */
  async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.client || !this.from) {
      this.logger.log({ msg: 'email skipped (disabled)', to: redactEmail(to), subject });
      return false;
    }
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Html: { Data: html } },
          },
        },
      }),
    );
    this.logger.log({ msg: 'email sent', to: redactEmail(to), subject });
    return true;
  }
}

/** `prince@example.com` → `p***@example.com` — log-safe recipient. */
function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return `***${email.slice(at)}`;
  return `${email[0]}***${email.slice(at)}`;
}
