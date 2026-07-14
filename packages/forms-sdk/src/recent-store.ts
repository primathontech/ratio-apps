const MAX = 8;

/**
 * Persists a short list of recent search queries in `localStorage`, scoped per
 * store. Most-recent-first, deduped case-insensitively, capped at 8 entries.
 * All access is private-mode safe (errors are swallowed).
 */
export class RecentStore {
  constructor(private readonly storeId: string) {}

  private get key(): string {
    return `forms:recent:${this.storeId}`;
  }

  list(): string[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      return [];
    }
  }

  add(q: string): void {
    const t = q.trim();
    if (!t) return;
    const lower = t.toLowerCase();
    const next = [t, ...this.list().filter((x) => x.toLowerCase() !== lower)].slice(0, MAX);
    this.save(next);
  }

  remove(q: string): void {
    const lower = q.trim().toLowerCase();
    this.save(this.list().filter((x) => x.toLowerCase() !== lower));
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {}
  }

  private save(items: string[]): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(items));
    } catch {}
  }
}
