import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { Logger } from '@nestjs/common';

/**
 * Provider seam for the email executor — injectable so tests script
 * success/failure without SES. The prod default is {@link SesEmailClient};
 * an unconfigured stack gets a logged no-op (local dev never emails).
 */
export interface EmailClientLike {
  send(message: { to: string; from: string; subject: string; text: string }): Promise<void>;
}

/** DI token for the email provider override (unset → env-derived default). */
export const FORMS_EMAIL_CLIENT = Symbol.for('ratio-app:forms:email-client');

/**
 * AWS SES SendEmail (TRD §7 decision: SES — the stack already carries AWS
 * SDK + creds for SQS/S3). Credentials resolve through the SDK default
 * chain; region from `AWS_REGION` (default ap-south-1). A rejected send
 * throws — the executor maps it to the retry state machine. The message
 * body is never logged here or in the executor.
 */
export class SesEmailClient implements EmailClientLike {
  private readonly client: SESClient;

  constructor(client?: SESClient) {
    this.client = client ?? new SESClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  }

  async send(message: { to: string; from: string; subject: string; text: string }): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: message.from,
        Destination: { ToAddresses: [message.to] },
        Message: {
          Subject: { Data: message.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: message.text, Charset: 'UTF-8' } },
        },
      }),
    );
  }
}

/**
 * Default provider resolution (read at construction):
 * `FORMS_EMAIL_FROM` set → real SES client; unset → a no-op that logs ONCE
 * and reports success, so local dev marks rows `sent` without delivering.
 */
export function createDefaultEmailClient(logger: Pick<Logger, 'warn'>): EmailClientLike {
  if (process.env.FORMS_EMAIL_FROM?.trim()) {
    return new SesEmailClient();
  }
  let warned = false;
  return {
    send: async () => {
      if (!warned) {
        warned = true;
        logger.warn(
          'no email provider configured (FORMS_EMAIL_FROM unset) — notification emails are logged as sent but not delivered',
        );
      }
    },
  };
}
