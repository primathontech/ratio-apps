import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** Two submissions inside the same 5s bucket from the same session collapse. */
export const FORMS_IDEMPOTENCY_BUCKET_MS = 5_000;

/** Submission idempotency (PublicFormGuard step 6, PRD F10): dedup is enforced by the DB's UNIQUE `idempotency_key` (INSERT collides), not a read-then-write race — the caller maps the violation via {@link isDuplicateKeyError}. */
@Injectable()
export class IdempotencyService {
  /** Deterministic given (formId, sessionKey, clock) — golden-digest tested. */
  computeKey(formId: string, sessionKey: string, now: number = Date.now()): string {
    const bucket = Math.floor(now / FORMS_IDEMPOTENCY_BUCKET_MS);
    return createHash('sha256').update(`${formId}:${sessionKey}:${bucket}`).digest('hex');
  }

  /** mysql2 surfaces UNIQUE violations as ER_DUP_ENTRY / errno 1062. */
  isDuplicateKeyError(err: unknown): boolean {
    if (err === null || typeof err !== 'object') return false;
    const e = err as { code?: unknown; errno?: unknown };
    return e.code === 'ER_DUP_ENTRY' || e.errno === 1062;
  }
}
