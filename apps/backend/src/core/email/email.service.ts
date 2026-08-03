import { type Body, SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Injectable, Logger, Optional } from '@nestjs/common';

/** A transactional email; provide `text` and/or `html` (both ⇒ multipart). `from` defaults to `EMAIL_FROM`. */
export interface EmailMessage {
  to: string | string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

/** SES sender for transactional email; a disabled no-op unless `EMAIL_FROM` is set, `EMAIL_REGION` overrides the SES region, a rejected send THROWS (caller owns retry policy), and the body is never logged. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: SESv2Client | null;
  private readonly from: string | undefined;

  constructor(@Optional() client?: SESv2Client) {
    this.from = process.env.EMAIL_FROM?.trim() || undefined;
    this.client =
      client ??
      (this.from
        ? new SESv2Client({
            region: process.env.EMAIL_REGION?.trim() || process.env.AWS_REGION || 'ap-south-1',
          })
        : null);
    if (!this.client) {
      this.logger.warn('EMAIL_FROM not set — email sending disabled (no-op)');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Send one email; true when sent, false on the disabled no-op path. Failures THROW — caller maps to its own policy. */
  async send(message: EmailMessage): Promise<boolean> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const from = message.from ?? this.from;
    if (!this.client || !from) {
      this.logger.log({
        msg: 'email skipped (disabled)',
        to: to.map(redactEmail),
        subject: message.subject,
      });
      return false;
    }
    const body: Body = {};
    if (message.text !== undefined) body.Text = { Data: message.text };
    if (message.html !== undefined) body.Html = { Data: message.html };
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: to },
        ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
        Content: { Simple: { Subject: { Data: message.subject }, Body: body } },
      }),
    );
    this.logger.log({ msg: 'email sent', to: to.map(redactEmail), subject: message.subject });
    return true;
  }
}

/** `prince@example.com` → `p***@example.com` — log-safe recipient. */
function redactEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return `***${email.slice(at)}`;
  return `${email[0]}***${email.slice(at)}`;
}
