/**
 * Race a promise against a timeout, ALWAYS clearing the timer when the
 * promise settles. The naked `Promise.race([p, setTimeout(...)])` pattern
 * leaks the timer when `p` wins — under sustained traffic (health probes
 * x N replicas) those dead timers accumulate and slow graceful shutdown.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'timeout',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
