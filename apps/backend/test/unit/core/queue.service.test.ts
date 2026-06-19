import { describe, expect, it, vi } from 'vitest';
import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
} from '@aws-sdk/client-sqs';
import { QueueService } from '../../../src/core/queue/queue.service';

/**
 * Build a QueueService whose internal SQSClient is replaced with a fake whose
 * `send` is the supplied spy. CreateQueue always resolves a stable URL so
 * ensureQueue succeeds; other commands fall through to `impl`.
 */
function makeService(impl: (cmd: unknown) => unknown = () => ({})): {
  svc: QueueService;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async (cmd: unknown) => {
    if (cmd instanceof CreateQueueCommand) {
      return { QueueUrl: `http://local/${(cmd.input as { QueueName: string }).QueueName}` };
    }
    return impl(cmd);
  });
  const svc = new QueueService();
  // Inject the fake client.
  (svc as unknown as { client: { send: typeof send } }).client = { send };
  return { svc, send };
}

describe('core QueueService', () => {
  it('accepts an arbitrary string queue name', async () => {
    const { svc, send } = makeService();
    await svc.sendBatch('some-other-queue', [{ a: 1 }]);
    const create = send.mock.calls.find((c) => c[0] instanceof CreateQueueCommand);
    expect((create?.[0].input as { QueueName: string }).QueueName).toBe('some-other-queue');
  });

  it('chunks >10 payloads into multiple SendMessageBatchCommands', async () => {
    const { svc, send } = makeService();
    const payloads = Array.from({ length: 23 }, (_, i) => ({ i }));
    await svc.sendBatch('q', payloads);

    const batches = send.mock.calls
      .map((c) => c[0])
      .filter((cmd): cmd is SendMessageBatchCommand => cmd instanceof SendMessageBatchCommand);
    // 23 → chunks of 10, 10, 3
    expect(batches).toHaveLength(3);
    expect(batches[0].input.Entries).toHaveLength(10);
    expect(batches[1].input.Entries).toHaveLength(10);
    expect(batches[2].input.Entries).toHaveLength(3);
    // JSON-encoded body
    expect(batches[0].input.Entries?.[0].MessageBody).toBe(JSON.stringify(payloads[0]));
  });

  it('sendBatch no-ops on empty payloads', async () => {
    const { svc, send } = makeService();
    await svc.sendBatch('q', []);
    expect(send).not.toHaveBeenCalled();
  });

  it('receive parses bodies and returns receipt handles', async () => {
    const { svc } = makeService((cmd) => {
      if (cmd instanceof ReceiveMessageCommand) {
        return {
          Messages: [
            { Body: JSON.stringify({ hello: 'world' }), ReceiptHandle: 'rh-1' },
            { Body: 'not-json', ReceiptHandle: 'rh-2' },
            { Body: JSON.stringify({ n: 2 }), ReceiptHandle: 'rh-3' },
          ],
        };
      }
      return {};
    });

    const msgs = await svc.receive<{ hello?: string; n?: number }>('q');
    // Undecodable body is dropped.
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ body: { hello: 'world' }, receiptHandle: 'rh-1' });
    expect(msgs[1]).toEqual({ body: { n: 2 }, receiptHandle: 'rh-3' });
  });

  it('ack deletes the supplied receipt handles', async () => {
    const { svc, send } = makeService();
    await svc.ack('q', ['rh-1', 'rh-2']);
    const del = send.mock.calls
      .map((c) => c[0])
      .find((cmd): cmd is DeleteMessageBatchCommand => cmd instanceof DeleteMessageBatchCommand);
    expect(del?.input.Entries).toEqual([
      { Id: '0', ReceiptHandle: 'rh-1' },
      { Id: '1', ReceiptHandle: 'rh-2' },
    ]);
  });

  it('ack no-ops on empty handles', async () => {
    const { svc, send } = makeService();
    await svc.ack('q', []);
    expect(send).not.toHaveBeenCalled();
  });
});
