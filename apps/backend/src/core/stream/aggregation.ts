/** Pack items into groups of at most `max` — each group becomes one Kinesis record. */
export function aggregate<T>(items: T[], max: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += max) out.push(items.slice(i, i + max));
  return out;
}
