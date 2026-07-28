/**
 * Shared queue-name resolver for the forms SQS pipelines.
 *
 * `core/queue/queue.service.ts` resolves queues by NAME (it calls the
 * idempotent CreateQueue under the hood), while the documented env keys
 * (`FORMS_*_QUEUE_URL`) may carry either a bare queue name or a full SQS queue
 * URL from IaC output. Accept both: a URL is reduced to its final path segment
 * (the queue name).
 */
export function queueNameFromEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/')) {
    const last = trimmed.split('/').filter(Boolean).at(-1);
    return last ?? null;
  }
  return trimmed;
}
