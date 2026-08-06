import { describe, expect, it, vi } from 'vitest';
import { SingleRunnerGuard } from '../../../../src/core/scheduling/single-runner';

const JOB_NAME = 'test job';

function fakeLogger() {
  return { warn: vi.fn() };
}

describe('SingleRunnerGuard.run', () => {
  it('passes through the wrapped function result and invokes it exactly once', async () => {
    const logger = fakeLogger();
    const guard = new SingleRunnerGuard(logger as never, JOB_NAME);
    const fn = vi.fn().mockResolvedValue('x');

    const result = await guard.run(fn, 'skip');

    expect(result).toBe('x');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('skips a second concurrent run while one is in flight and warns exactly once', async () => {
    const logger = fakeLogger();
    const guard = new SingleRunnerGuard(logger as never, JOB_NAME);

    let resolveFirst: (v: string) => void = () => {};
    const firstPending = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const firstFn = vi.fn().mockImplementation(() => firstPending);
    const secondFn = vi.fn().mockResolvedValue('second');

    const first = guard.run(firstFn, 'skip');
    const second = await guard.run(secondFn, 'skip');

    expect(second).toBe('skip');
    expect(secondFn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({
      msg: `${JOB_NAME} already running — skipping overlapping cycle`,
    });

    resolveFirst('first');
    await expect(first).resolves.toBe('first');
  });

  it('resets the guard after the wrapped function rejects so a later run succeeds', async () => {
    const logger = fakeLogger();
    const guard = new SingleRunnerGuard(logger as never, JOB_NAME);
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const succeeding = vi.fn().mockResolvedValue('ok');

    await expect(guard.run(failing, 'skip')).rejects.toThrow('boom');

    await expect(guard.run(succeeding, 'skip')).resolves.toBe('ok');
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});
