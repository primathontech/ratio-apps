import { vi } from 'vitest';

interface EachMessageArgs {
  topic: string;
  partition: number;
  message: { offset: string; value: Buffer | null };
}

export function makeFakeKafka() {
  let eachMessage: ((args: EachMessageArgs) => Promise<void>) | null = null;
  const commits: { topic: string; partition: number; offset: string }[] = [];

  const consumer = {
    connect: vi.fn(async () => {}),
    subscribe: vi.fn(async (_opts: { topics: string[]; fromBeginning: boolean }) => {}),
    run: vi.fn(async (cfg: { eachMessage: (args: EachMessageArgs) => Promise<void> }) => {
      eachMessage = cfg.eachMessage;
    }),
    commitOffsets: vi.fn(
      async (offsets: { topic: string; partition: number; offset: string }[]) => {
        commits.push(...offsets);
      },
    ),
    disconnect: vi.fn(async () => {}),
  };

  const client = { consumer: () => consumer };

  async function deliver(
    topic: string,
    partition: number,
    offset: number,
    value: string | null,
  ): Promise<void> {
    if (!eachMessage) throw new Error('run() was not called — start the worker first');
    await eachMessage({
      topic,
      partition,
      message: { offset: String(offset), value: value === null ? null : Buffer.from(value) },
    });
  }

  return { client, consumer, commits, deliver };
}
