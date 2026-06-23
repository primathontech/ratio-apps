import { describe, expect, it } from 'vitest';
import { OPEN_STORE_EVENT_NAMES } from '../constants/_template-events';
import {
  buildDefaultEventMap,
  buildSdkEventNameMap,
  eventMapSchema,
  normalizeMetaEventNames,
} from './event-map';

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

  it("buildDefaultEventMap('meta') yields Title-Case Meta Conversions-API names", () => {
    const map = buildDefaultEventMap('meta');
    // Meta uses PascalCase identity names matching the OpenStore event keys
    expect(map.PageView.name).toBe('PageView');
    expect(map.Purchase.name).toBe('Purchase');
    expect(map.AddToCart.name).toBe('AddToCart');
    expect(map.ViewContent.name).toBe('ViewContent');
    // All events are enabled by default
    expect(map.PageView.enabled).toBe(true);
    expect(map.Purchase.enabled).toBe(true);
  });

  it("buildDefaultEventMap('moengage') yields MoEngage Title-Case names", () => {
    const map = buildDefaultEventMap('moengage');
    // MoEngage uses human-readable spaced Title Case
    expect(map.PageView.name).toBe('Page View');
    expect(map.Purchase.name).toBe('Purchase');
    expect(map.ViewContent.name).toBe('Product Viewed');
  });

  it('buildDefaultEventMap() (no-arg) still yields template snake_case names for back-compat', () => {
    const map = buildDefaultEventMap();
    expect(map.PageView.name).toBe('pageview');
    expect(map.Purchase.name).toBe('purchase');
    expect(map.AddToCart.name).toBe('add_to_cart');
  });

  describe('normalizeMetaEventNames', () => {
    it('forces every event name back to the canonical Meta standard name', () => {
      const map = buildDefaultEventMap('meta');
      // Simulate a merchant rename that would break firing.
      map.ViewContent = { enabled: true, name: 'ViewContentsss' };
      const out = normalizeMetaEventNames(map);
      expect(out.ViewContent.name).toBe('ViewContent');
    });

    it('preserves the enabled/disabled toggle while resetting the name', () => {
      const map = buildDefaultEventMap('meta');
      map.PageView = { enabled: false, name: 'CustomPV' };
      const out = normalizeMetaEventNames(map);
      expect(out.PageView.enabled).toBe(false);
      expect(out.PageView.name).toBe('PageView');
    });

    it('leaves an already-canonical map unchanged and stays schema-valid', () => {
      const map = buildDefaultEventMap('meta');
      const out = normalizeMetaEventNames(map);
      expect(out).toEqual(map);
      expect(eventMapSchema.safeParse(out).success).toBe(true);
    });
  });
});
