import type { Logger } from '@nestjs/common';

/**
 * Guards a periodic job body against overlapping runs — adopt this instead
 * of hand-rolling a `private running = false` flag per cron service.
 */
export class SingleRunnerGuard {
  private running = false;

  constructor(
    private readonly logger: Logger,
    private readonly jobName: string,
  ) {}

  async run<T>(fn: () => Promise<T>, skipValue: T): Promise<T> {
    if (this.running) {
      this.logger.warn({ msg: `${this.jobName} already running — skipping overlapping cycle` });
      return skipValue;
    }
    this.running = true;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }
}
