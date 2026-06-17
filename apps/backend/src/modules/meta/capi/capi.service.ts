import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MetaConfig } from '@ratio-app/shared/schemas/meta-config';
import type { MerchantsService } from '../../../core/merchants/merchants.service';
import { MetaConfigService } from '../config/config.service';
import type { MetaDatabase } from '../db/types';
import { META_MERCHANTS } from '../tokens';

/**
 * Graph API base, read at CALL TIME (not module load) so a `.env` override
 * (e.g. a local mock) applied by ConfigModule is honored. Defaults to the
 * real Meta Graph API.
 */
function graphBase(): string {
  return process.env.FACEBOOK_CAPI_BASE_URL ?? 'https://graph.facebook.com/v21.0';
}

/** Raw user_data as the browser sends it (Call B) — PII unhashed, cookies as-is. */
interface RawUserData {
  em?: string;
  ph?: string;
  fn?: string;
  ln?: string;
  external_id?: string;
  fbp?: string;
  fbc?: string;
}

/** A single CAPI event as posted by the browser SDK (Call B). */
export interface RawCapiEvent {
  event_name: string;
  event_id?: string;
  event_time?: number;
  event_source_url?: string;
  action_source?: string;
  user_data?: RawUserData;
  custom_data?: Record<string, unknown>;
}

/** Server-side context injected by the controller (never trust the client for these). */
export interface CapiContext {
  clientIp?: string;
  userAgent?: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

function normalizePhone(v: string): string {
  // digits only; prepend India country code if a bare 10-digit number.
  const digits = v.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function normalizeName(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Already-hashed (64-char hex) values are passed through, never double-hashed. */
function hashed(value: string, normalizer: (v: string) => string): string {
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  return sha256(normalizer(value));
}

/**
 * Meta Conversions API dispatch (Call C). Receives the browser's batched
 * events (Call B), hashes PII, enriches with server IP/UA, enforces the
 * merchant's data-sharing level, and POSTs to graph.facebook.com for each
 * configured pixel.
 *
 * Phase 1 dispatches inline (per request). The TRD's 20M/day path adds a
 * Kafka buffer + worker pool in front of this same dispatch logic (M3/M7) —
 * `dispatch()` is the unit that a worker would call.
 */
@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  constructor(
    private readonly configs: MetaConfigService,
    @Inject(META_MERCHANTS) private readonly merchants: MerchantsService<MetaDatabase>,
  ) {}

  async dispatch(
    merchantId: string,
    rawEvents: RawCapiEvent[],
    ctx: CapiContext,
  ): Promise<{ received: number; dispatched: number; failed: number; errors: string[] }> {
    // Defensive copy — prevents mutation of the caller's array across async gaps
    const events = [...rawEvents];
    if (!events?.length) return { received: 0, dispatched: 0, failed: 0, errors: [] };

    this.logger.log({
      msg: 'CAPI dispatch received',
      merchantId,
      eventCount: events.length,
      events: events.map((e) => ({ name: e.event_name, id: e.event_id })),
    });

    const merchant = await this.merchants.findById(merchantId);
    if (!merchant?.isActive) return { received: events.length, dispatched: 0, failed: 0, errors: [] };

    let config: MetaConfig;
    try {
      config = await this.configs.getByMerchantId(merchantId);
    } catch {
      return { received: events.length, dispatched: 0, failed: 0, errors: [] };
    }
    if (!config.pixelId || !config.capiAccessToken) {
      this.logger.warn({
        msg: 'CAPI dispatch skipped - missing config',
        merchantId,
        hasPixelId: Boolean(config.pixelId),
        hasToken: Boolean(config.capiAccessToken),
      });
      return { received: events.length, dispatched: 0, failed: 0, errors: [] };
    }

    const allowed = events.filter((e) => this.levelAllows(config.dataSharingLevel, e.event_name));
    if (!allowed.length) {
      this.logger.warn({
        msg: 'CAPI dispatch - no events pass data sharing level',
        merchantId,
        level: config.dataSharingLevel,
      });
      return { received: events.length, dispatched: 0, failed: 0, errors: [] };
    }

    const data = allowed.map((e) => this.toMetaEvent(e, ctx));
    const pixelIds = config.pixelId
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.logger.log({
      msg: 'CAPI dispatch sending to pixels',
      merchantId,
      pixelCount: pixelIds.length,
      eventCount: allowed.length,
    });

    let dispatched = 0;
    let failed = 0;
    const errors: string[] = [];
    await Promise.all(
      pixelIds.map(async (pixelId) => {
        try {
          await this.sendToPixel(pixelId, config.capiAccessToken, data);
          this.logger.log({
            msg: 'CAPI dispatch to pixel success',
            merchantId,
            pixelId,
            eventCount: allowed.length,
          });
          dispatched += allowed.length;
        } catch (err) {
          // Count + capture the failure reason so the caller (worker) can withhold
          // the queue ack and let the batch redeliver (Meta dedupes on event_id),
          // and so analytics can show WHY events failed. Swallowing this here is
          // what silently lost events before.
          failed += 1;
          errors.push(err instanceof Error ? err.message : String(err));
          this.logger.error({ msg: 'CAPI dispatch failed', merchantId, pixelId, err });
        }
      }),
    );

    this.logger.log({
      msg: 'CAPI dispatch complete',
      merchantId,
      received: events.length,
      dispatched,
      failed,
    });

    return { received: events.length, dispatched, failed, errors };
  }

  private levelAllows(level: MetaConfig['dataSharingLevel'], eventName: string): boolean {
    if (level === 'standard') return false; // pixel-only, no CAPI
    if (level === 'enhanced') return eventName === 'Purchase';
    return true; // maximum
  }

  private toMetaEvent(e: RawCapiEvent, ctx: CapiContext): Record<string, unknown> {
    const u = e.user_data ?? {};
    const userData: Record<string, unknown> = {};
    if (u.em) userData.em = [hashed(u.em, normalizeEmail)];
    if (u.ph) userData.ph = [hashed(u.ph, normalizePhone)];
    if (u.fn) userData.fn = [hashed(u.fn, normalizeName)];
    if (u.ln) userData.ln = [hashed(u.ln, normalizeName)];
    if (u.external_id) userData.external_id = [hashed(u.external_id, (v) => v.trim())];
    if (u.fbp) userData.fbp = u.fbp;
    if (u.fbc) userData.fbc = u.fbc;
    if (ctx.clientIp) userData.client_ip_address = ctx.clientIp;
    if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;
    userData.country = [sha256('in')]; // India merchants — free EMQ point

    return {
      event_name: e.event_name,
      event_id: e.event_id,
      event_time: e.event_time ?? Math.floor(Date.now() / 1000),
      event_source_url: e.event_source_url,
      action_source: e.action_source ?? 'website',
      user_data: userData,
      custom_data: e.custom_data ?? {},
    };
  }

  private async sendToPixel(
    pixelId: string,
    accessToken: string,
    data: Record<string, unknown>[],
  ): Promise<void> {
    const url = `${graphBase()}/${pixelId}/events`;
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;

    // When META_TEST_EVENT_CODE is set, tag the request so events show up in
    // Meta's "Test Events" tab in real time. Read at call time (like graphBase)
    // so it can be toggled via .env without a rebuild. Leave unset in prod.
    const testEventCode = process.env.META_TEST_EVENT_CODE;
    const body = JSON.stringify(
      testEventCode
        ? { data, access_token: accessToken, test_event_code: testEventCode }
        : { data, access_token: accessToken },
    );

    // Log the EXACT Call C request (URL + full payload, token redacted) at INFO
    // so BOTH normal and test events can be diffed against a manual curl. The
    // only difference between a normal and a test request is the presence of
    // `test_event_code`. Verbose per-event — dial down via LOG_LEVEL for real
    // production traffic.
    this.logger.log({
      msg: 'CAPI Call C request',
      url,
      mode: testEventCode ? 'test' : 'normal',
      payload: testEventCode
        ? { data, test_event_code: testEventCode, access_token: '***redacted***' }
        : { data, access_token: '***redacted***' },
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Exponential backoff with jitter: 0ms, ~500ms, ~1000ms
      if (attempt > 1) {
        const base = 500 * 2 ** (attempt - 2);
        const jitter = Math.random() * base * 0.3;
        await new Promise((r) => setTimeout(r, base + jitter));
      }

      // 10-second timeout per attempt
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });

        // 4xx = bad request — no point retrying, data won't change
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text().catch(() => '');
          throw new Error(`Meta CAPI ${res.status} (non-retryable): ${text.slice(0, 500)}`);
        }

        if (!res.ok) {
          // 5xx — retryable
          const text = await res.text().catch(() => '');
          lastErr = new Error(`Meta CAPI ${res.status}: ${text.slice(0, 500)}`);
          this.logger.warn({ msg: 'CAPI dispatch retryable error', pixelId, attempt, status: res.status });
          continue;
        }

        return; // success
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        // Network errors and timeouts are retryable; non-retryable errors bubble up
        if (err instanceof Error && err.message.includes('non-retryable')) throw err;
        lastErr = isAbort ? new Error('Meta CAPI timeout after 10s') : err;
        this.logger.warn({ msg: 'CAPI dispatch retryable error', pixelId, attempt, err: lastErr });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastErr ?? new Error('Meta CAPI failed after retries');
  }
}
