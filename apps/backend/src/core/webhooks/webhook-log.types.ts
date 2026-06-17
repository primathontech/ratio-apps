import type { ColumnType, Generated } from 'kysely';

export interface BaseWebhookLogTable {
  id: Generated<string>;
  ratioWebhookId: string;
  merchantId: string | null;
  topic: string;
  payload: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  signatureOk: boolean;
  processedAt: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  receivedAt: Generated<Date>;
}

export interface DatabaseWithWebhookLog {
  webhook_log: BaseWebhookLogTable;
}
