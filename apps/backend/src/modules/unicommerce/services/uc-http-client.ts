import { Injectable } from '@nestjs/common';
import type { UcApiResponse, UcHttpClient } from './order-push-worker.service';

/**
 * Concrete `UcHttpClient` used by `UcOrderPushWorkerService`/
 * `UcCancelPushWorkerService` at runtime — a plain external HTTP call to
 * Unicommerce's `genericproxy` gateway. Unlike `RatioClient` (which
 * validates Ratio's OWN API responses against a Zod schema), this only
 * validates the one thing both callers actually depend on — a real
 * `status` field — rather than a full schema, since UC's contract for this
 * gateway is otherwise undocumented beyond `{status, message, data}`
 * (confirmed directly against postorders.html).
 */
@Injectable()
export class UcHttpClientImpl implements UcHttpClient {
  async post(
    url: string,
    body: unknown,
    opts: { headers: Record<string, string> },
  ): Promise<UcApiResponse> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...opts.headers },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Unicommerce order push failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as Partial<UcApiResponse>;
    if (json.status !== 'success' && json.status !== 'failure') {
      throw new Error(`Unicommerce response missing a valid "status" field: ${JSON.stringify(json)}`);
    }
    return json as UcApiResponse;
  }
}
