import { Logger } from '@nestjs/common';

export const CLEVERTAP_CATALOG_CONTRACT_VERIFIED = true;

export const CLEVERTAP_CATALOG_GET_URL_PATH = '/get_catalog_url';
export const CLEVERTAP_CATALOG_COMPLETED_PATH = '/upload_catalog_completed';

export const CLEVERTAP_CATALOG_TIMEOUT_MS = 10_000;

const MAX_VENDOR_ERROR_LEN = 200;

export const CATALOG_NOT_CONFIGURED = 'catalog contract unverified — forwarding gated off';

export interface ClevertapCatalogClientOptions {
  apiHost: string;
  fetchImpl?: typeof fetch;
}

export interface ClevertapCatalogUploadInput {
  accountId: string;
  passcode: string;
  name: string;
  creator: string;
  email: string;
  csv: string;
  replace?: boolean;
}

export interface ClevertapCatalogResult {
  ok: boolean;
  status: number;
  skipped?: boolean;
  error?: string;
}

export type ClevertapCatalogClientFactory = (apiHost: string) => ClevertapCatalogUploader;

export interface ClevertapCatalogUploader {
  uploadCatalog(input: ClevertapCatalogUploadInput): Promise<ClevertapCatalogResult>;
}

export const CLEVERTAP_CATALOG_CLIENT_FACTORY = Symbol.for(
  'ratio-app:clevertap:catalog-client-factory',
);

export class ClevertapCatalogClient implements ClevertapCatalogUploader {
  private readonly logger = new Logger(ClevertapCatalogClient.name);
  private readonly apiHost: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClevertapCatalogClientOptions) {
    this.apiHost = opts.apiHost.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async uploadCatalog(input: ClevertapCatalogUploadInput): Promise<ClevertapCatalogResult> {
    if (!CLEVERTAP_CATALOG_CONTRACT_VERIFIED) {
      this.logger.warn({
        msg: 'catalog upload gated off — contract unverified, nothing sent',
        status: 0,
      });
      return { ok: false, status: 0, skipped: true, error: CATALOG_NOT_CONFIGURED };
    }

    const replace = input.replace ?? true;
    const authHeaders = {
      'content-type': 'application/json',
      accept: 'application/json',
      'X-CleverTap-Account-Id': input.accountId,
      'X-CleverTap-Passcode': input.passcode,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLEVERTAP_CATALOG_TIMEOUT_MS);
    try {
      const getUrlRes = await this.fetchImpl(`${this.apiHost}${CLEVERTAP_CATALOG_GET_URL_PATH}`, {
        method: 'POST',
        headers: authHeaders,
        signal: controller.signal,
      });
      const getUrlText = await safeText(getUrlRes);
      if (!getUrlRes.ok) {
        return {
          ok: false,
          status: getUrlRes.status,
          error: describeFailure(`clevertap get_catalog_url ${getUrlRes.status}`, getUrlText),
        };
      }
      const presignedUrl = readPresignedUrl(getUrlText);
      if (!presignedUrl) {
        return {
          ok: false,
          status: getUrlRes.status,
          error: 'clevertap get_catalog_url missing upload url',
        };
      }

      const putRes = await this.fetchImpl(presignedUrl, {
        method: 'PUT',
        headers: { 'content-type': 'text/csv' },
        body: input.csv,
        signal: controller.signal,
      });
      if (!putRes.ok) {
        return {
          ok: false,
          status: putRes.status,
          error: describeFailure(`clevertap csv put ${putRes.status}`, await safeText(putRes)),
        };
      }

      const completedRes = await this.fetchImpl(
        `${this.apiHost}${CLEVERTAP_CATALOG_COMPLETED_PATH}`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            name: input.name,
            creator: input.creator,
            email: input.email,
            url: presignedUrl,
            replace,
            override: false,
            isLocationCatalog: false,
          }),
          signal: controller.signal,
        },
      );
      const completedText = await safeText(completedRes);
      if (!completedRes.ok) {
        return {
          ok: false,
          status: completedRes.status,
          error: describeFailure(
            `clevertap upload_catalog_completed ${completedRes.status}`,
            completedText,
          ),
        };
      }
      const status = readBatchStatus(completedText);
      if (status !== 'success') {
        return {
          ok: false,
          status: completedRes.status,
          error: describeFailure(`clevertap catalog completed ${status}`, completedText),
        };
      }
      return { ok: true, status: completedRes.status };
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'fetch_error';
      this.logger.error({ msg: 'catalog upload failed', status: 0, reason });
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

function readPresignedUrl(bodyText: string): string | null {
  const parsed = parseJsonObject(bodyText);
  if (!parsed) return null;
  for (const key of ['presignedS3URL', 'url', 'presignedUrl', 'presigned_url']) {
    const v = parsed[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

function readBatchStatus(bodyText: string): string {
  const parsed = parseJsonObject(bodyText);
  if (!parsed) return 'unreadable';
  return typeof parsed.status === 'string' && parsed.status ? parsed.status : 'unreadable';
}

function describeFailure(prefix: string, bodyText: string): string {
  const parsed = parseJsonObject(bodyText);
  const code =
    parsed && (typeof parsed.code === 'number' || typeof parsed.code === 'string')
      ? parsed.code
      : undefined;
  const rawError = parsed?.Error ?? parsed?.error;
  const error = typeof rawError === 'string' ? clampVendorText(rawError) : undefined;
  return [prefix, code, error].filter((p) => p !== undefined && p !== '').join(' ');
}

function clampVendorText(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_VENDOR_ERROR_LEN ? flat.slice(0, MAX_VENDOR_ERROR_LEN) : flat;
}

function parseJsonObject(bodyText: string): Record<string, unknown> | null {
  if (!bodyText) return null;
  try {
    const v = JSON.parse(bodyText);
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
