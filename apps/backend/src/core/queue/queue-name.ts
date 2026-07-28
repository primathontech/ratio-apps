/** Resolve a queue NAME from `FORMS_*_QUEUE_URL`, which may carry a bare name or a full SQS URL (reduced to its final path segment). */
export function queueNameFromEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.includes('/')) {
    const last = trimmed.split('/').filter(Boolean).at(-1);
    return last ?? null;
  }
  return trimmed;
}
