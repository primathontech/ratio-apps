/**
 * Thin, typed client for the Google Analytics Admin API (v1beta). Mirrors
 * `ContentApiClient`: injected `fetchImpl`, Bearer token from `getAccessToken`,
 * never logs tokens. Reads the merchant's web-stream Measurement IDs.
 */
export interface Ga4Stream {
  measurementId: string;
  displayName?: string;
  property?: string;
}

export interface Ga4AdminClientOptions {
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://analyticsadmin.googleapis.com/v1beta';
const MAX_PROPERTIES = 25;

interface GoogleErrorBody {
  error?: { message?: string };
}

export class Ga4AdminError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'Ga4AdminError';
    this.status = status;
  }
}

export class Ga4AdminClient {
  private readonly getAccessToken: () => Promise<string>;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Ga4AdminClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /** List web-stream Measurement IDs across the account's properties. */
  async listWebMeasurementIds(): Promise<Ga4Stream[]> {
    const summaries = await this.request<{
      accountSummaries?: Array<{ propertySummaries?: Array<{ property?: string; displayName?: string }> }>;
    }>(`${this.baseUrl}/accountSummaries`);

    const properties = (summaries.accountSummaries ?? [])
      .flatMap((a) => a.propertySummaries ?? [])
      .filter((p): p is { property: string; displayName?: string } => typeof p.property === 'string')
      .slice(0, MAX_PROPERTIES);

    const streams: Ga4Stream[] = [];
    for (const p of properties) {
      const res = await this.request<{
        dataStreams?: Array<{ type?: string; displayName?: string; webStreamData?: { measurementId?: string } }>;
      }>(`${this.baseUrl}/${p.property}/dataStreams`);
      for (const ds of res.dataStreams ?? []) {
        const measurementId = ds.webStreamData?.measurementId;
        if (ds.type === 'WEB_DATA_STREAM' && measurementId) {
          const displayName = ds.displayName ?? p.displayName;
          streams.push({
            measurementId,
            ...(displayName ? { displayName } : {}),
            property: p.property,
          });
        }
      }
    }
    return streams;
  }

  private async request<T>(url: string): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as GoogleErrorBody;
        if (body?.error?.message) message = body.error.message;
      } catch {
        // non-JSON body — keep statusText
      }
      throw new Ga4AdminError(response.status, message);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
