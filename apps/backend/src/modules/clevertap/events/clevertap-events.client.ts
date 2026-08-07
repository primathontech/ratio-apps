import { Logger } from '@nestjs/common';
import type { ClevertapUploadRecord } from './order-event.mapper';

export const CLEVERTAP_UPLOAD_TIMEOUT_MS = 10_000;

export const CLEVERTAP_UPLOAD_PATH = '/1/upload';

export const UNREADABLE_BATCH_STATUS = 'unreadable';

const MAX_VENDOR_ERROR_LEN = 200;

export interface ClevertapEventsClientOptions {
  apiHost: string;
  fetchImpl?: typeof fetch;
}

export interface ClevertapUploadInput {
  accountId: string;
  passcode: string;
  records: readonly ClevertapUploadRecord[];
}

export interface ClevertapUploadResult {
  ok: boolean;
  status: number;
  error?: string;
}

export type ClevertapEventsClientFactory = (apiHost: string) => ClevertapEventsUploader;

export interface ClevertapEventsUploader {
  upload(input: ClevertapUploadInput): Promise<ClevertapUploadResult>;
}

export const CLEVERTAP_EVENTS_CLIENT_FACTORY = Symbol.for(
  'ratio-app:clevertap:events-client-factory',
);

export class ClevertapEventsClient implements ClevertapEventsUploader {
  private readonly logger = new Logger(ClevertapEventsClient.name);
  private readonly apiHost: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClevertapEventsClientOptions) {
    this.apiHost = opts.apiHost.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async upload(input: ClevertapUploadInput): Promise<ClevertapUploadResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLEVERTAP_UPLOAD_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.apiHost}${CLEVERTAP_UPLOAD_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'X-CleverTap-Account-Id': input.accountId,
          'X-CleverTap-Passcode': input.passcode,
        },
        body: JSON.stringify({ d: input.records }),
        signal: controller.signal,
      });
      const bodyText = await safeText(res);

      if (!res.ok) {
        const detail = readFailureDetail(bodyText);
        this.logger.error({ msg: 'clevertap upload rejected', status: res.status, ...detail });
        return {
          ok: false,
          status: res.status,
          error: describeFailure(`clevertap ${res.status}`, dropRedundantCode(detail, res.status)),
        };
      }

      const batchStatus = readBatchStatus(bodyText);
      if (batchStatus !== 'success') {
        const detail = readFailureDetail(bodyText);
        this.logger.error({
          msg: 'clevertap upload not accepted',
          status: res.status,
          batchStatus,
          ...detail,
        });
        return {
          ok: false,
          status: res.status,
          error: describeFailure(`clevertap batch ${batchStatus}`, detail),
        };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'fetch_error';
      this.logger.error({ msg: 'clevertap upload failed', status: 0, reason });
      return { ok: false, status: 0, error: reason === 'AbortError' ? 'timeout' : reason };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function readBatchStatus(bodyText: string): string {
  const parsed = parseJsonObject(bodyText);
  if (!parsed) return UNREADABLE_BATCH_STATUS;
  return typeof parsed.status === 'string' && parsed.status
    ? parsed.status
    : UNREADABLE_BATCH_STATUS;
}

interface ClevertapFailureDetail {
  code?: number | string;
  error?: string;
}

function readFailureDetail(bodyText: string): ClevertapFailureDetail {
  const parsed = parseJsonObject(bodyText);
  if (!parsed) return {};
  const perRecord = Array.isArray(parsed.unprocessed) ? asObject(parsed.unprocessed[0]) : null;
  const fromRecord = pickDetail(perRecord);
  return fromRecord.code !== undefined || fromRecord.error !== undefined
    ? fromRecord
    : pickDetail(parsed);
}

function pickDetail(source: Record<string, unknown> | null): ClevertapFailureDetail {
  if (!source) return {};
  const code = source.code;
  const error = typeof source.error === 'string' ? clampVendorText(source.error) : '';
  return {
    ...(typeof code === 'number' || (typeof code === 'string' && code.trim() !== '')
      ? { code }
      : {}),
    ...(error ? { error } : {}),
  };
}

function dropRedundantCode(
  detail: ClevertapFailureDetail,
  httpStatus: number,
): ClevertapFailureDetail {
  if (detail.code === undefined || String(detail.code) !== String(httpStatus)) return detail;
  const { code: _code, ...rest } = detail;
  return rest;
}

function describeFailure(prefix: string, detail: ClevertapFailureDetail): string {
  return [prefix, detail.code, detail.error]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
}

function clampVendorText(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_VENDOR_ERROR_LEN ? flat.slice(0, MAX_VENDOR_ERROR_LEN) : flat;
}

function parseJsonObject(bodyText: string): Record<string, unknown> | null {
  if (!bodyText) return null;
  try {
    return asObject(JSON.parse(bodyText));
  } catch {
    return null;
  }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
