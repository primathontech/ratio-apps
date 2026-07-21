/**
 * Loyalty SQS queue names + message contracts (TRD §6).
 *
 * Both queues are consumed only when `LOYALTY_WORKER_ENABLED=true` (shared-api
 * worker placement). Names are plain strings — `QueueService` ensures the
 * queue lazily on first use.
 */
export const LOYALTY_QUEUE_NAMES = {
  bulkOps: 'loyalty-bulk-ops',
  exports: 'loyalty-exports',
} as const;

/** Max `loyalty_bulk_operation_rows.id`s carried by one bulk-ops message. */
export const LOYALTY_BULK_ROWS_PER_MESSAGE = 500;

/** One batch of bulk rows to process. `rowIds` ≤ {@link LOYALTY_BULK_ROWS_PER_MESSAGE}. */
export interface LoyaltyBulkMessage {
  opId: string;
  merchantId: string;
  rowIds: number[];
}

/** One export job to build (stream mirror → gzip CSV → S3). */
export interface LoyaltyExportMessage {
  exportId: string;
  merchantId: string;
}
