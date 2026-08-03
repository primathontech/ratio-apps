import { createSign, generateKeyPairSync } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FormsBounceController } from '../../../../src/modules/forms/outbound/bounce.controller';
import {
  FormsBounceService,
  type SnsFetchLike,
} from '../../../../src/modules/forms/outbound/bounce.service';
import type { FormsEmailService } from '../../../../src/modules/forms/outbound/email.service';
import { buildCanonicalString, type SnsMessage } from '../../../../src/modules/forms/outbound/sns-signature';
import { makeFakeHandle, type Row } from './fixtures/fake-db';
import { emailLogRow, MERCHANT_ID, OTHER_MERCHANT_ID } from './fixtures/forms';

const CERT_URL = 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem';
const SUBSCRIBE_URL = 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok';
const TOPIC_ARN = 'arn:aws:sns:ap-south-1:123456789012:forms-bounces';
const BOUNCED = 'owner@merchant.example';

// One RSA keypair for the whole suite: the private key signs, the "cert" the
// fake fetch serves is the matching public key PEM (Node's verify accepts a
// bare public key PEM as well as an X.509 certificate).
let publicKeyPem: string;
let privateKeyPem: string;

beforeAll(() => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  publicKeyPem = publicKey;
  privateKeyPem = privateKey;
});

/** Sign the SNS canonical string with the suite private key (SignatureVersion 1 = SHA1). */
function sign(msg: Omit<SnsMessage, 'Signature'>): string {
  const signer = createSign('RSA-SHA1');
  signer.update(buildCanonicalString({ ...msg, Signature: '' } as SnsMessage), 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

function bounceNotification(recipient = BOUNCED): Omit<SnsMessage, 'Signature'> {
  return {
    Type: 'Notification',
    MessageId: 'mid-1',
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify({
      notificationType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: recipient }],
      },
    }),
    Timestamp: '2026-07-28T00:00:00.000Z',
    SignatureVersion: '1',
    SigningCertURL: CERT_URL,
  };
}

function subscriptionConfirmation(): Omit<SnsMessage, 'Signature'> {
  return {
    Type: 'SubscriptionConfirmation',
    MessageId: 'mid-2',
    TopicArn: TOPIC_ARN,
    Token: 'tok',
    SubscribeURL: SUBSCRIBE_URL,
    Message: 'You have chosen to subscribe',
    Timestamp: '2026-07-28T00:00:00.000Z',
    SignatureVersion: '1',
    SigningCertURL: CERT_URL,
  };
}

function makeService(seed: Record<string, Row[]> = {}) {
  const fake = makeFakeHandle(seed);
  const email = { markBounced: vi.fn(async () => {}) };
  const fetchImpl: SnsFetchLike = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    text: async () => (url === CERT_URL ? publicKeyPem : ''),
  }));
  const service = new FormsBounceService(
    fake.handle,
    email as unknown as FormsEmailService,
    fetchImpl,
  );
  return { service, email, fetchImpl, fake };
}

describe('FormsBounceService — SNS signature verification (PRD AC9)', () => {
  it('accepts a correctly-signed bounce and marks the resolved merchant (200)', async () => {
    const seed = { form_email_log: [emailLogRow({ recipient: BOUNCED, merchantId: MERCHANT_ID })] };
    const { service, email } = makeService(seed);
    const msg = bounceNotification();
    const result = await service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) }));

    expect(result).toEqual({ ok: true });
    expect(email.markBounced).toHaveBeenCalledTimes(1);
    expect(email.markBounced).toHaveBeenCalledWith(MERCHANT_ID, BOUNCED);
  });

  it('rejects a tampered signature and never calls markBounced', async () => {
    const seed = { form_email_log: [emailLogRow({ recipient: BOUNCED })] };
    const { service, email } = makeService(seed);
    const msg = bounceNotification();
    const good = sign(msg);
    // Flip a character so the signature no longer matches the canonical string.
    const bad = `${good.slice(0, -2)}${good.slice(-2) === 'AA' ? 'BB' : 'AA'}`;

    await expect(service.ingest(JSON.stringify({ ...msg, Signature: bad }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(email.markBounced).not.toHaveBeenCalled();
  });

  it('rejects a SigningCertURL that is not an AWS SNS host (no cert fetch)', async () => {
    const { service, email, fetchImpl } = makeService();
    const msg = { ...bounceNotification(), SigningCertURL: 'https://evil.example.com/cert.pem' };

    await expect(service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(email.markBounced).not.toHaveBeenCalled();
  });

  it('rejects a verified message from an unexpected topic when FORMS_SNS_TOPIC_ARN is pinned', async () => {
    const prev = process.env.FORMS_SNS_TOPIC_ARN;
    process.env.FORMS_SNS_TOPIC_ARN = 'arn:aws:sns:ap-south-1:123456789012:some-other-topic';
    try {
      const { service, email } = makeService();
      const msg = bounceNotification();
      await expect(
        service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(email.markBounced).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.FORMS_SNS_TOPIC_ARN;
      else process.env.FORMS_SNS_TOPIC_ARN = prev;
    }
  });
});

describe('FormsBounceService — SubscriptionConfirmation (PRD AC9)', () => {
  it('auto-confirms by fetching the (AWS-host) SubscribeURL, no bounce processing', async () => {
    const { service, email, fetchImpl } = makeService();
    const msg = subscriptionConfirmation();
    const result = await service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) }));

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(SUBSCRIBE_URL);
    expect(email.markBounced).not.toHaveBeenCalled();
  });

  it('refuses to fetch a SubscribeURL that is not an AWS SNS host', async () => {
    const { service } = makeService();
    const msg = { ...subscriptionConfirmation(), SubscribeURL: 'https://evil.example.com/confirm' };
    await expect(
      service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('FormsBounceService — merchant resolution (PRD AC9)', () => {
  it('resolves every distinct merchant that emailed the bounced recipient', async () => {
    const seed = {
      form_email_log: [
        emailLogRow({ id: 1, recipient: BOUNCED, merchantId: MERCHANT_ID }),
        emailLogRow({ id: 2, recipient: BOUNCED, merchantId: OTHER_MERCHANT_ID }),
        emailLogRow({ id: 3, recipient: 'someone-else@x.example', merchantId: MERCHANT_ID }),
      ],
    };
    const { service, email } = makeService(seed);
    const msg = bounceNotification();
    await service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) }));

    expect(email.markBounced).toHaveBeenCalledTimes(2);
    expect(email.markBounced).toHaveBeenCalledWith(MERCHANT_ID, BOUNCED);
    expect(email.markBounced).toHaveBeenCalledWith(OTHER_MERCHANT_ID, BOUNCED);
  });

  it('a non-bounce SES notification is a verified no-op', async () => {
    const { service, email } = makeService();
    const msg = {
      ...bounceNotification(),
      Message: JSON.stringify({ notificationType: 'Delivery' }),
    };
    const result = await service.ingest(JSON.stringify({ ...msg, Signature: sign(msg) }));
    expect(result).toEqual({ ok: true });
    expect(email.markBounced).not.toHaveBeenCalled();
  });
});

describe('FormsBounceController', () => {
  it('prefers the captured raw body and delegates to the service', async () => {
    const bounce = { ingest: vi.fn(async () => ({ ok: true as const })) };
    const controller = new FormsBounceController(bounce as unknown as FormsBounceService);
    const raw = Buffer.from('{"Type":"Notification"}');

    await controller.receive({ rawBody: raw, body: { parsed: true } } as never);
    expect(bounce.ingest).toHaveBeenCalledWith(raw);
  });

  it('falls back to the parsed body when no raw body was captured', async () => {
    const bounce = { ingest: vi.fn(async () => ({ ok: true as const })) };
    const controller = new FormsBounceController(bounce as unknown as FormsBounceService);
    await controller.receive({ body: { Type: 'Notification' } } as never);
    expect(bounce.ingest).toHaveBeenCalledWith({ Type: 'Notification' });
  });
});
