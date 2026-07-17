import { APPS, type AppSlug } from './apps';

/**
 * Which vendor modules THIS process runs, from `ENABLED_MODULES`.
 *   unset | 'all'  → every slug in APPS (dev monolith / default)
 *   'google,posthog,moengage,wizzy' → exactly that production workload subset
 * Unknown slugs fail fast so a typo can't silently mount nothing.
 */
export function resolveEnabledModules(raw = process.env.ENABLED_MODULES): AppSlug[] {
  const v = (raw ?? 'all').trim();
  if (v === 'all' || v === '') return [...APPS];
  const slugs = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = slugs.filter((s) => !(APPS as readonly string[]).includes(s));
  if (unknown.length) {
    throw new Error(
      `ENABLED_MODULES contains unknown slug(s): ${unknown.join(', ')}. Valid: ${APPS.join(', ')}`,
    );
  }
  return slugs as AppSlug[];
}
