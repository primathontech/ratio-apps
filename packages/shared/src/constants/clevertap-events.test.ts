import { describe, expect, it } from 'vitest';
import {
  CLEVERTAP_CHARGED_EVENT,
  CLEVERTAP_REGIONS,
  type ClevertapRegion,
  DEFAULT_CLEVERTAP_EVENT_MAP,
  DEFAULT_CLEVERTAP_REGION,
} from './clevertap-events';

/**
 * The region table is the highest-consequence constant in this package: it is
 * the only thing a merchant reads before choosing where their events are sent,
 * and a wrong choice 401s every server-side event with no obvious cause.
 *
 * `aps3` shipped as "Mumbai (aps3)", which is **Indonesia** — an Indian merchant
 * scanning the dropdown for their own city would have picked it. The expected
 * countries below are transcribed from CleverTap's official region table
 * (https://developer.clevertap.com/docs/idc); do not "fix" them to match the
 * code, fix the code to match them.
 */

/** region key → the country/area CleverTap says that data centre serves. */
const OFFICIAL_REGION_COUNTRY: Record<ClevertapRegion, string> = {
  in1: 'India',
  sg1: 'Singapore',
  us1: 'United States',
  aps3: 'Indonesia',
  mec1: 'Middle East',
  eu1: 'Europe',
};

describe('CLEVERTAP_REGIONS — labels name the right country', () => {
  it.each(
    Object.entries(OFFICIAL_REGION_COUNTRY) as [ClevertapRegion, string][],
  )('%s is labelled %s', (region, country) => {
    expect(CLEVERTAP_REGIONS[region].label).toContain(country);
  });

  it('labels the aps3 data centre Indonesia, never an Indian city', () => {
    // The exact regression: India is `in1`. If this ever reads "Mumbai" or
    // "India" again, Indian merchants get silently pointed at Indonesia.
    expect(CLEVERTAP_REGIONS.aps3.label).toBe('Indonesia (aps3)');
    expect(CLEVERTAP_REGIONS.aps3.label).not.toMatch(/Mumbai|India\b/);
  });

  it('labels exactly one region as India, and it is in1', () => {
    const indian = (Object.keys(CLEVERTAP_REGIONS) as ClevertapRegion[]).filter((r) =>
      /India\b/.test(CLEVERTAP_REGIONS[r].label),
    );
    expect(indian).toEqual(['in1']);
  });

  it('every label carries its own region code, so the dropdown is unambiguous', () => {
    for (const region of Object.keys(CLEVERTAP_REGIONS) as ClevertapRegion[]) {
      expect(CLEVERTAP_REGIONS[region].label).toContain(`(${region})`);
    }
  });

  it('no two regions share a label', () => {
    const labels = Object.values(CLEVERTAP_REGIONS).map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('CLEVERTAP_REGIONS — hosts', () => {
  it('derives both hosts from the region key', () => {
    for (const region of Object.keys(CLEVERTAP_REGIONS) as ClevertapRegion[]) {
      expect(CLEVERTAP_REGIONS[region].apiHost).toBe(`https://${region}.api.clevertap.com`);
      expect(CLEVERTAP_REGIONS[region].dashboard).toBe(`https://${region}.dashboard.clevertap.com`);
    }
  });

  it('labels eu1 as "global" too — that is what CleverTap\'s dashboard shows', () => {
    // Verified 2026-07-29 against a real trial account: Settings → Project
    // reported `Region: global`, and our dropdown had no such option. Both the
    // apex host and eu1.api.clevertap.com accepted that account's credentials
    // (in1 returned 401), so eu1 IS the right mapping — the label must name both
    // spellings or the merchant cannot find their own region.
    expect(CLEVERTAP_REGIONS.eu1.label.toLowerCase()).toContain('global');
  });

  it("keeps eu1 — it is CleverTap's own global default, not a stray entry", () => {
    // Their Node SDK falls back to eu1 when no region is supplied, so dropping
    // eu1 here would strand any merchant whose account really does live there.
    expect(CLEVERTAP_REGIONS).toHaveProperty('eu1');
  });

  it("defaults to in1 for Ratio's Indian merchant base", () => {
    expect(DEFAULT_CLEVERTAP_REGION).toBe('in1');
    expect(CLEVERTAP_REGIONS[DEFAULT_CLEVERTAP_REGION].label).toContain('India');
  });
});

describe('DEFAULT_CLEVERTAP_EVENT_MAP', () => {
  it("maps Purchase to CleverTap's reserved Charged event", () => {
    // Revenue attribution, RFM and post-purchase Journeys all key off the exact
    // string `Charged`; anything else silently drops the merchant's revenue.
    expect(DEFAULT_CLEVERTAP_EVENT_MAP.Purchase).toBe(CLEVERTAP_CHARGED_EVENT);
    expect(CLEVERTAP_CHARGED_EVENT).toBe('Charged');
  });
});
