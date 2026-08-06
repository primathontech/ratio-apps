import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { UnicommerceDatabase } from '../db/types';
import { UC_DB_TOKEN } from '../kysely.module';

export interface EventLogEntry {
  merchantId: string;
  direction: 'inbound' | 'outbound';
  flow: 'auth' | 'order_push' | 'inventory' | 'dispatch' | 'cancel' | 'status' | 'catalog' | 'webhook';
  reference: string;
  result: 'success' | 'failed' | 'partial';
  payload: unknown;
  response?: unknown;
  jobId?: string;
}

/**
 * Builds the exact `.values(...)` row for an `ucEventLogs` insert, including
 * the JSON.stringify mysql2 requires (it doesn't auto-serialize JS objects
 * into JSON columns — see webhooks.service.ts's identical note). Exported so
 * webhook handlers that must write via their own `trx` (not this service's
 * own connection) can still produce an identical row — see the doc on
 * `UcProductSyncHandler`/`UcOrderConfirmedHandler` for why that matters here:
 * a handler running inside the webhook-dispatch transaction (which holds a
 * lock on the `merchants` row) writing to `uc_event_logs` — which has its own
 * `merchants` FK — via a SEPARATE connection would reproduce the exact
 * cross-connection deadlock migration 0008 fixed for `uc_order_item_map`.
 */
export function buildEventLogRow(entry: EventLogEntry) {
  return {
    merchantId: entry.merchantId,
    direction: entry.direction,
    flow: entry.flow,
    reference: entry.reference,
    result: entry.result,
    payload: JSON.stringify(entry.payload),
    response: entry.response ? JSON.stringify(entry.response) : null,
    jobId: entry.jobId ?? null,
  };
}

@Injectable()
export class UcEventLogService {
  constructor(@Inject(UC_DB_TOKEN) private readonly handle: KyselyClient<UnicommerceDatabase>) {}

  async record(entry: EventLogEntry): Promise<void> {
    await this.handle.db.insertInto('ucEventLogs').values(buildEventLogRow(entry)).execute();
  }
}
