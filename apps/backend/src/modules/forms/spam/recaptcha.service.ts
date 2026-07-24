import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CryptoService } from '../../../core/crypto/crypto.service';
import { FORMS_CRYPTO } from '../tokens';

/** Google's server-side verification endpoint. */
const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** How long we wait on Google before falling back to honeypot-only (F8). */
const SITEVERIFY_TIMEOUT_MS = 5_000;

const DEFAULT_THRESHOLD = 0.3;

/**
 * Minimal fetch shape the verifier needs — constructor-injectable so tests
 * script responses/outages without touching the network.
 */
export type RecaptchaFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** DI token for the fetch override (unset in prod → global fetch). */
export const FORMS_RECAPTCHA_FETCH = Symbol.for('ratio-app:forms:recaptcha-fetch');

export interface RecaptchaResult {
  verdict: 'pass' | 'reject' | 'unavailable';
  score?: number;
}

/** The slice of the merchant's config the verifier consumes. */
export interface RecaptchaConfigInput {
  /** AES-256-GCM ciphertext of the merchant's secret (null → shared key mode). */
  recaptchaSecretEnc: string | null;
  /** DECIMAL comes back from mysql2 as a string — accept both. */
  recaptchaThreshold: number | string | null | undefined;
}

/**
 * Server-side reCAPTCHA v3 verification (PublicFormGuard chain step 4).
 *
 * Secret resolution: the merchant's decrypted secret when set, else the
 * shared `FORMS_RECAPTCHA_SHARED_SECRET` env key. Score below the merchant's
 * threshold (default 0.30) → `reject` (the caller answers with a SILENT fake
 * success per PRD F7). Google unreachable / no secret configured →
 * `unavailable` (the caller falls back to honeypot-only per PRD F8).
 *
 * REDACTION: neither the secret nor any submission field ever reaches a log
 * line — log payloads carry only verdict metadata.
 */
@Injectable()
export class FormsRecaptchaService {
  private readonly logger = new Logger(FormsRecaptchaService.name);
  private readonly fetchImpl: RecaptchaFetchLike;

  constructor(
    @Inject(FORMS_CRYPTO) private readonly crypto: CryptoService,
    @Optional() @Inject(FORMS_RECAPTCHA_FETCH) fetchImpl?: RecaptchaFetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as RecaptchaFetchLike);
  }

  async verify(token: string | undefined, config: RecaptchaConfigInput): Promise<RecaptchaResult> {
    // Check the secret before the token: no secret configured means reCAPTCHA
    // can't run at all → unavailable → honeypot fallback (F8), not a reject.
    const secret = this.resolveSecret(config);
    if (!secret) {
      this.logger.warn({ msg: 'recaptcha selected but no secret configured — honeypot fallback' });
      return { verdict: 'unavailable' };
    }

    // Secret set but no token → reCAPTCHA never ran client-side → bot (F7).
    if (!token) {
      return { verdict: 'reject' };
    }

    const threshold = this.resolveThreshold(config);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token }).toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn({ msg: 'recaptcha siteverify non-OK response', status: res.status });
        return { verdict: 'unavailable' };
      }
      const body = (await res.json()) as { success?: boolean; score?: number };
      if (body.success !== true) {
        // Token invalid / expired / wrong site — a failed verification, not
        // an outage: treat as bot.
        return { verdict: 'reject' };
      }
      const score = typeof body.score === 'number' ? body.score : 0;
      if (score < threshold) {
        return { verdict: 'reject', score };
      }
      return { verdict: 'pass', score };
    } catch {
      // Network error / timeout — Google unreachable. Caller falls back to
      // honeypot-only (PRD F8). Never log the error object here: fetch errors
      // can echo the request body (which carries the secret).
      this.logger.warn({ msg: 'recaptcha siteverify unreachable — falling back to honeypot-only' });
      return { verdict: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Merchant secret (decrypted) when set, else the shared env secret. */
  private resolveSecret(config: RecaptchaConfigInput): string | null {
    if (config.recaptchaSecretEnc) {
      try {
        return this.crypto.decrypt(config.recaptchaSecretEnc);
      } catch {
        this.logger.warn({ msg: 'failed to decrypt merchant recaptcha secret — using shared key' });
      }
    }
    return process.env.FORMS_RECAPTCHA_SHARED_SECRET?.trim() || null;
  }

  private resolveThreshold(config: RecaptchaConfigInput): number {
    const raw = Number(config.recaptchaThreshold);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_THRESHOLD;
  }
}
