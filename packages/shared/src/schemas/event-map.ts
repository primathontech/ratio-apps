import { z } from 'zod';
import { DEFAULT_EVENT_MAP, DEFAULT_TEMPLATE_EVENT_MAP } from '../constants/_template-events';
import { DEFAULT_META_EVENT_MAP } from '../constants/meta-events';
import { DEFAULT_MOENGAGE_EVENT_MAP } from '../constants/moengage-events';
import { OPEN_STORE_EVENT_NAMES, type OpenStoreEventName } from '../constants/openstore-events';

/**
 * Per-event override the merchant configures.
 * `enabled=false` removes the OS event subscription entirely in the SDK.
 * `name` is the Template event name to emit (falls back to default if empty).
 */
export const eventOverrideSchema = z.object({
  enabled: z.boolean(),
  name: z
    .string()
    .trim()
    .min(1, 'event name must not be empty')
    .max(64, 'event name must be at most 64 characters')
    .regex(/^[A-Za-z0-9 _$.-]+$/, 'letters, digits, spaces, _ - . $ only'),
});

export type EventOverride = z.infer<typeof eventOverrideSchema>;

/**
 * The full 13-event map. Each OS event name is required to be present;
 * unknown keys are stripped.
 */
const eventMapShape = Object.fromEntries(
  (Object.keys(DEFAULT_EVENT_MAP) as OpenStoreEventName[]).map((k) => [k, eventOverrideSchema]),
) as Record<OpenStoreEventName, typeof eventOverrideSchema>;

export const eventMapSchema = z.object(eventMapShape).strict();

export type EventMap = z.infer<typeof eventMapSchema>;

/**
 * Build a fully-defaulted event map (used at install time and when the merchant
 * resets to defaults). The optional `vendor` argument selects the per-vendor
 * source map:
 *   - `'moengage'` uses Title Case MoEngage names (e.g. `'Page View'`)
 *   - `'meta'` uses Title-Case Meta Conversions-API names (e.g. `'PageView'`)
 *   - all other vendors (posthog, google, _template) and no-arg callers use
 *     the template's snake_case names (e.g. `'pageview'`) for full back-compat.
 */
export function buildDefaultEventMap(vendor?: 'meta' | 'posthog' | 'moengage'): EventMap {
  const source: Record<OpenStoreEventName, string> =
    vendor === 'moengage'
      ? DEFAULT_MOENGAGE_EVENT_MAP
      : vendor === 'meta'
        ? DEFAULT_META_EVENT_MAP
        : DEFAULT_TEMPLATE_EVENT_MAP;
  return Object.fromEntries(
    OPEN_STORE_EVENT_NAMES.map((k) => [k, { enabled: true, name: source[k] }]),
  ) as EventMap;
}

/**
 * Force every event's `name` back to the canonical Meta standard name, keeping
 * the merchant's enabled/disabled choice. The Meta app intentionally does NOT
 * support renaming: a renamed standard event (e.g. `ViewContent` → `ViewContentsss`)
 * becomes a Meta CUSTOM event (losing standard-event optimization) AND breaks SDK
 * firing (the gate keys on the canonical name). So the admin only toggles
 * enable/disable, and the server normalizes the stored name here — defense in
 * depth, and it repairs any already-renamed config on the next save.
 */
export function normalizeMetaEventNames(events: EventMap): EventMap {
  return Object.fromEntries(
    (Object.entries(events) as [OpenStoreEventName, EventOverride][]).map(([osName, ov]) => [
      osName,
      { enabled: ov.enabled, name: DEFAULT_META_EVENT_MAP[osName] ?? osName },
    ]),
  ) as EventMap;
}

/**
 * The runtime map the SDK actually uses: only enabled events,
 * keyed by OS event name, valued by the merchant-chosen Template event name.
 * Equivalent to the prototype's `buildSdkEventMap()`.
 */
export function buildSdkEventNameMap(
  events: EventMap,
): Partial<Record<OpenStoreEventName, string>> {
  const out: Partial<Record<OpenStoreEventName, string>> = {};
  for (const [osName, override] of Object.entries(events) as [
    OpenStoreEventName,
    EventOverride,
  ][]) {
    if (override.enabled && override.name) {
      out[osName] = override.name;
    }
  }
  return out;
}
