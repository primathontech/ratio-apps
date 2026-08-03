import { createVerify } from 'node:crypto';

export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn?: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Token?: string;
  SubscribeURL?: string;
}

/** Fields in AWS's fixed canonical signing order per message type (Subject skipped when absent). */
const SIGNED_KEYS: Record<SnsMessage['Type'], readonly string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
  UnsubscribeConfirmation: [
    'Message',
    'MessageId',
    'SubscribeURL',
    'Timestamp',
    'Token',
    'TopicArn',
    'Type',
  ],
};

/** The `key\nvalue\n` canonical string SNS signs (fields present only). */
export function buildCanonicalString(msg: SnsMessage): string {
  const keys = SIGNED_KEYS[msg.Type];
  if (!keys) throw new Error('unsupported SNS message type');
  let out = '';
  for (const key of keys) {
    const value = (msg as unknown as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    out += `${key}\n${String(value)}\n`;
  }
  return out;
}

/** Security: SigningCertURL/SubscribeURL must be HTTPS on an AWS SNS host — the allowlist that stops SSRF to an attacker-controlled cert. */
export function isAwsSnsUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i.test(url.hostname);
}

/** Security: verify base64 Signature over the canonical string with the cert PEM; SignatureVersion 1 ⇒ RSA-SHA1, 2 ⇒ RSA-SHA256; any error is a failure, not a throw. */
export function verifySnsSignature(msg: SnsMessage, certPem: string): boolean {
  const algorithm = msg.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
  try {
    const verifier = createVerify(algorithm);
    verifier.update(buildCanonicalString(msg), 'utf8');
    verifier.end();
    return verifier.verify(certPem, msg.Signature, 'base64');
  } catch {
    return false;
  }
}
