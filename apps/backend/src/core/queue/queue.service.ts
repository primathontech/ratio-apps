import { Injectable, Logger } from '@nestjs/common';
import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

/**
 * Thin, vendor-agnostic SQS wrapper. Same code talks to real Amazon SQS (prod)
 * or a local SQS-compatible broker (ElasticMQ in Docker) — only env differs:
 *
 *   LOCAL  SQS_ENDPOINT=http://localhost:9324  AWS_REGION=elasticmq
 *          AWS_ACCESS_KEY_ID=x  AWS_SECRET_ACCESS_KEY=x   (creds ignored by ElasticMQ)
 *   PROD   (no SQS_ENDPOINT) → SDK hits real SQS with the pod's IAM role.
 *
 * Queues are ensured lazily on first use (CreateQueue is idempotent and works on
 * both SQS and ElasticMQ; in real prod they'd also exist via IaC). Per-module
 * queue-name constants live in the module that owns them (e.g. meta's
 * `QUEUE_NAMES`); this service accepts any string queue name.
 */
export type QueueName = string;

export interface ReceivedMessage<T = unknown> {
  body: T;
  receiptHandle: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly client: SQSClient;
  /** logical name → resolved queue URL */
  private readonly urls = new Map<string, string>();

  constructor() {
    const endpoint = process.env.SQS_ENDPOINT;
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'ap-south-1',
      ...(endpoint ? { endpoint } : {}),
      // ElasticMQ ignores creds, but the SDK requires them to sign.
      ...(endpoint
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'x',
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'x',
            },
          }
        : {}),
    });
  }

  private async ensureQueue(name: QueueName): Promise<string> {
    const cached = this.urls.get(name);
    if (cached) return cached;
    const res = await this.client.send(new CreateQueueCommand({ QueueName: name }));
    const url = res.QueueUrl;
    if (!url) throw new Error(`no QueueUrl for ${name}`);
    this.urls.set(name, url);
    this.logger.log({ msg: 'queue ready', name, url });
    return url;
  }

  /** Enqueue a batch of payloads (chunked to SQS's 10-per-call limit). */
  async sendBatch(name: QueueName, payloads: unknown[]): Promise<void> {
    if (!payloads.length) return;
    const url = await this.ensureQueue(name);
    for (let i = 0; i < payloads.length; i += 10) {
      const chunk = payloads.slice(i, i + 10);
      await this.client.send(
        new SendMessageBatchCommand({
          QueueUrl: url,
          Entries: chunk.map((p, j) => ({
            Id: String(i + j),
            MessageBody: JSON.stringify(p),
          })),
        }),
      );
    }
  }

  /**
   * Long-poll up to 10 messages. `visibilityTimeout` (seconds) hides received
   * messages from other consumers while in flight — set it ABOVE any buffering
   * window in the worker (e.g. > 5 min) so accumulated-but-un-acked messages
   * don't redeliver mid-batch.
   */
  async receive<T = unknown>(
    name: QueueName,
    max = 10,
    waitSeconds = 5,
    visibilityTimeout?: number,
  ): Promise<ReceivedMessage<T>[]> {
    const url = await this.ensureQueue(name);
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: Math.min(max, 10),
        WaitTimeSeconds: waitSeconds,
        ...(visibilityTimeout ? { VisibilityTimeout: visibilityTimeout } : {}),
      }),
    );
    return (res.Messages ?? []).flatMap((m) => {
      if (!m.Body || !m.ReceiptHandle) return [];
      try {
        return [{ body: JSON.parse(m.Body) as T, receiptHandle: m.ReceiptHandle }];
      } catch {
        // Undecodable body → drop the reference; it will hit the redrive policy.
        return [];
      }
    });
  }

  /** Ack (delete) processed messages. */
  async ack(name: QueueName, receiptHandles: string[]): Promise<void> {
    if (!receiptHandles.length) return;
    const url = await this.ensureQueue(name);
    for (let i = 0; i < receiptHandles.length; i += 10) {
      const chunk = receiptHandles.slice(i, i + 10);
      await this.client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: url,
          Entries: chunk.map((h, j) => ({ Id: String(i + j), ReceiptHandle: h })),
        }),
      );
    }
  }
}
