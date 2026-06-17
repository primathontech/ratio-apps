import { z } from 'zod';
import { DEFAULT_EVENT_MAP, DEFAULT_TEMPLATE_EVENT_MAP } from '../constants/_template-events';
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
 * resets to defaults). Seeds every OpenStore event from the template's default
 * map. A real vendor with multiple event dialects can reintroduce a `vendor`
 * argument here and branch on it.
 */
export function buildDefaultEventMap(): EventMap {
  const source: Record<OpenStoreEventName, string> = DEFAULT_TEMPLATE_EVENT_MAP;
  return Object.fromEntries(
    OPEN_STORE_EVENT_NAMES.map((k) => [k, { enabled: true, name: source[k] }]),
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
