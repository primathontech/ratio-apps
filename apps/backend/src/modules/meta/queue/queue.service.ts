/**
 * Meta's view of the shared SQS wrapper.
 *
 * The `QueueService` implementation now lives in `core/queue` so other modules
 * (e.g. Google) can reuse the same infra — shared infra lives in `core/`, never
 * copied per-vendor. Meta keeps its own logical queue-name constants here.
 *
 * Logical queues used by the Meta module:
 *   meta-capi          — browser conversion events → Meta CAPI dispatch
 *   meta-capi-dlq      — poison/exhausted CAPI events
 */
export { QueueService, type ReceivedMessage, type QueueName } from '../../../core/queue/queue.service';

// Only events use a queue. Catalog work streams directly (no queue).
export const QUEUE_NAMES = {
  capi: 'meta-capi',
  capiDlq: 'meta-capi-dlq',
} as const;

/** Meta's own narrowed queue-name union, derived from the constants above. */
export type MetaQueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
