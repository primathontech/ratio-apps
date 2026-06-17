import { describe, expect, it } from 'vitest';
import { OPEN_STORE_EVENT_NAMES } from '../constants/_template-events';
import { buildDefaultEventMap, buildSdkEventNameMap, eventMapSchema } from './event-map';

describe('event-map schema', () => {
  it('builds a default map with all 13 events enabled', () => {
    const map = buildDefaultEventMap();
    expect(Object.keys(map)).toHaveLength(13);
    for (const name of OPEN_STORE_EVENT_NAMES) {
      expect(map[name].enabled).toBe(true);
    }
  });

  it('parses a complete map', () => {
    const result = eventMapSchema.safeParse(buildDefaultEventMap());
    expect(result.success).toBe(true);
  });

  it('rejects a map missing an event', () => {
    const map = buildDefaultEventMap();
    delete (map as Record<string, unknown>).Purchase;
    expect(eventMapSchema.safeParse(map).success).toBe(false);
  });

  it('rejects names with characters outside the allowed set', () => {
    const map = buildDefaultEventMap();
    map.Purchase = { enabled: true, name: 'has@symbol' };
    expect(eventMapSchema.safeParse(map).success).toBe(false);
  });

  it('accepts Template-style names with spaces', () => {
    const map = buildDefaultEventMap();
    map.AddToCart = { enabled: true, name: 'Add To Cart' };
    expect(eventMapSchema.safeParse(map).success).toBe(true);
  });

  it('rejects whitespace-only names', () => {
    const map = buildDefaultEventMap();
    map.AddToCart = { enabled: true, name: '   ' };
    expect(eventMapSchema.safeParse(map).success).toBe(false);
  });

  it('rejects names longer than 64 characters', () => {
    const map = buildDefaultEventMap();
    map.AddToCart = { enabled: true, name: 'a'.repeat(65) };
    expect(eventMapSchema.safeParse(map).success).toBe(false);
  });

  it('seeds names from the template default map', () => {
    const map = buildDefaultEventMap();
    expect(map.PageView.name).toBe('pageview');
    expect(map.AddToCart.name).toBe('add_to_cart');
  });

  it('buildSdkEventNameMap omits disabled events', () => {
    const map = buildDefaultEventMap();
    map.PageView = { enabled: false, name: 'pageview' };
    const sdkMap = buildSdkEventNameMap(map);
    expect(sdkMap.PageView).toBeUndefined();
    expect(sdkMap.Purchase).toBe('purchase');
  });
});
