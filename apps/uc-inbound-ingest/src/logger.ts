export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(obj: Record<string, unknown>): void;
  info(obj: Record<string, unknown>): void;
  warn(obj: Record<string, unknown>): void;
  error(obj: Record<string, unknown>): void;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Minimal structured logger: every line is a single JSON object with a `msg`
 * key, mirroring the backend's pino output shape (without pulling pino into
 * this deliberately dependency-light app).
 */
export function createLogger(level: LogLevel): Logger {
  const min = LEVEL_RANK[level] ?? 3;

  function emit(
    rank: number,
    method: keyof Pick<Console, 'debug' | 'info' | 'warn' | 'error'>,
    obj: Record<string, unknown>,
  ): void {
    if (rank < min) return;
    console[method](JSON.stringify(obj));
  }

  return {
    debug: (obj) => emit(0, 'debug', obj),
    info: (obj) => emit(1, 'info', obj),
    warn: (obj) => emit(2, 'warn', obj),
    error: (obj) => emit(3, 'error', obj),
  };
}
