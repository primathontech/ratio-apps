# Pixel install UX — implementation plan
**Goal:** Drop the "Pending API" surface, make the hosted pixel register as one `google-ratio` pixel, and show the real storefront install (layout.tsx `<Script>` + `pixelConfig.ts`).
**Spec:** docs/agent/changes/pixel-install-ux/SPEC.md
**Execution:** invoke the `execute` skill (it asks subagent-driven vs inline).

**Files**
- Modify: `apps/backend/static/google-pixel.js` — register one `google-ratio` pixel.
- Modify: `apps/backend/test/unit/apps/google/google-pixel.test.ts` — assert the single registration.
- Modify: `apps/admin-google/src/routes/index.tsx` — remove the Pending-API status; show Configured/Not-configured.
- Modify: `apps/admin-google/src/routes/index.test.tsx` — drop the "Pending API" assertion.
- Modify: `apps/admin-google/src/components/ScriptTagPanel.tsx` — real install snippets.
- Modify: `apps/_template-admin/src/components/ScriptTagPanel.tsx` — same generic fix (reference-only).

`config.test.tsx` needs no change (its fixture's `ga4PixelStatus`/`adsPixelStatus` stay valid — the API/schema are unchanged; UI-only removal).

---

### Task 1: Bundle → single `google-ratio` registration

**Files:**
- Test: `apps/backend/test/unit/apps/google/google-pixel.test.ts`
- Modify: `apps/backend/static/google-pixel.js`

- [ ] **Step 1: Update the registration assertions to expect one `google-ratio` pixel**

In `google-pixel.test.ts`, replace the test body of `it('registers GA4 + Ads with the runtime when both are configured', ...)` assertion:
```ts
    expect(Object.keys(h.registrations)).toEqual(['google-ratio']);
```
and replace the `it('registers only GA4 when Ads is absent', ...)` assertion:
```ts
    // One unified pixel; GA4 wired, Ads not (no conversionId).
    expect(Object.keys(h.registrations)).toEqual(['google-ratio']);
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/google/google-pixel.test.ts`
Expected: FAIL — current bundle registers `['ga4','google-ads']`, not `['google-ratio']`.

- [ ] **Step 3: Implement — register one combined pixel**

In `apps/backend/static/google-pixel.js`, replace the block (lines ~155–167):
```js
  // ─── Register with the storefront pixel runtime ─────────────────────────────
  function registerAll(runtime) {
    if (CFG.ga4 && CFG.ga4.measurementId) runtime.register(ga4Registration);
    if (CFG.ads && CFG.ads.conversionId) runtime.register(adsRegistration);
  }
  if (window.__OPEN_STORE_PIXEL_RUNTIME__) {
    registerAll(window.__OPEN_STORE_PIXEL_RUNTIME__);
  } else {
    // Runtime not ready — queue so it picks us up on init.
    window.__OPEN_STORE_PIXEL_PENDING__ = window.__OPEN_STORE_PIXEL_PENDING__ || [];
    if (CFG.ga4 && CFG.ga4.measurementId) window.__OPEN_STORE_PIXEL_PENDING__.push(ga4Registration);
    if (CFG.ads && CFG.ads.conversionId) window.__OPEN_STORE_PIXEL_PENDING__.push(adsRegistration);
  }
})();
```
with:
```js
  // ─── Register with the storefront pixel runtime ─────────────────────────────
  // One app = one pixel. `google-ratio` wires whichever of GA4 / Google Ads is
  // configured (both share window.gtag). The storefront activates it via
  // pixelConfig.ts: `"google-ratio": {}` (config comes from the prelude above,
  // not from pixelConfig). Matches the posthog-ratio convention and avoids
  // colliding with any legacy `ga4` / `google-ads` pixelConfig keys.
  var googleRatioRegistration = {
    name: "google-ratio",
    register: function (analytics) {
      ga4Registration.register(analytics); // no-ops if CFG.ga4 absent
      adsRegistration.register(analytics); // no-ops if CFG.ads absent
    },
  };
  var shouldRegister =
    (CFG.ga4 && CFG.ga4.measurementId) || (CFG.ads && CFG.ads.conversionId);
  if (shouldRegister) {
    if (window.__OPEN_STORE_PIXEL_RUNTIME__) {
      window.__OPEN_STORE_PIXEL_RUNTIME__.register(googleRatioRegistration);
    } else {
      // Runtime not ready — queue so it picks us up on init.
      window.__OPEN_STORE_PIXEL_PENDING__ = window.__OPEN_STORE_PIXEL_PENDING__ || [];
      window.__OPEN_STORE_PIXEL_PENDING__.push(googleRatioRegistration);
    }
  }
})();
```
(Leave `ga4Registration` / `adsRegistration` defined above as internal helpers — each already early-returns when its config is absent.)

- [ ] **Step 4: Run it — expect PASS**

Run: `cd apps/backend && pnpm exec vitest run test/unit/apps/google/google-pixel.test.ts`
Expected: PASS — all GA4/Ads event-mapping + co-existence (one `purchase` + one `conversion`, no double-count) cases still green under the single registration.

- [ ] **Step 5: `pnpm verify`**

Run: `pnpm verify` (from repo root). Expected: green.

---

### Task 2: Dashboard — remove "Pending API", show Configured / Not configured

**Files:**
- Test: `apps/admin-google/src/routes/index.test.tsx`
- Modify: `apps/admin-google/src/routes/index.tsx`

- [ ] **Step 1: Update the dashboard test to drop the Pending-API assertion**

In `index.test.tsx`, replace the assertion line:
```ts
    expect(screen.getByText('Pending API')).toBeInTheDocument();
```
with an assertion on the new indicator + the configured ID (GA4 is enabled in the fixture):
```ts
    expect(screen.getByText('G-TEST123')).toBeInTheDocument();
    expect(screen.getAllByText('Configured').length).toBeGreaterThan(0);
```
(If the fixture's `ga4MeasurementId` differs, match its actual value; keep `ga4Enabled: true` so the card shows "Configured".)

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @ratio-app/admin-google exec vitest run src/routes/index.test.tsx`
Expected: FAIL — "Pending API" no longer the target / "Configured" not yet rendered.

- [ ] **Step 3: Implement — remove StatusTag/STATUS_META, add Configured/Not-configured**

In `apps/admin-google/src/routes/index.tsx`:
1. Remove the `type PixelStatus = …`, the `STATUS_META` constant, and the `StatusTag` component (lines ~21–33).
2. Remove `Tag` from the `@primathonos/orion` import (no longer used).
3. Replace the GA4 card's `<div><StatusTag status={data?.ga4PixelStatus ?? 'disabled'} /></div>` with:
```tsx
              <div>
                <Tag color={data?.ga4Enabled ? 'green' : 'default'}>
                  {data?.ga4Enabled ? 'Configured' : 'Not configured'}
                </Tag>
              </div>
```
4. Replace the Ads card's `<div><StatusTag status={data?.adsPixelStatus ?? 'disabled'} /></div>` with:
```tsx
              <div>
                <Tag color={data?.adsEnabled ? 'green' : 'default'}>
                  {data?.adsEnabled ? 'Configured' : 'Not configured'}
                </Tag>
              </div>
```
5. Keep `Tag` in the import (steps 3–4 still use it) — i.e. do NOT remove `Tag`; only remove `StatusTag`/`STATUS_META`/`PixelStatus`.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @ratio-app/admin-google exec vitest run src/routes/index.test.tsx`
Expected: PASS.

- [ ] **Step 5: `pnpm verify`**

Run: `pnpm verify`. Expected: green (no unused `PixelStatus`/`StatusTag`).

---

### Task 3: `ScriptTagPanel` (google admin) — real storefront install

**Files:**
- Modify: `apps/admin-google/src/components/ScriptTagPanel.tsx`

(No unit test for this component; verified via typecheck/build.)

- [ ] **Step 1: Replace the panel body with the real install instructions**

Replace the whole `return (...)` in `ScriptTagPanel.tsx` so it shows the `<Script>` for `layout.tsx` + the `pixelConfig.ts` entry, both copyable, and drops the `<head>` wording:
```tsx
  const scriptTag = `<Script src="${scriptUrl}" strategy="afterInteractive" />`;
  const pixelConfigLine = `"google-ratio": {},`;

  return (
    <Card
      title="Install on your storefront"
      extra={
        <Typography.Text type="secondary">2 steps — config comes from this app, not env vars</Typography.Text>
      }
    >
      <Typography.Paragraph strong style={{ marginBottom: 4 }}>
        1. Add the script to <Typography.Text code>src/app/layout.tsx</Typography.Text> (with the other pixel SDKs):
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: scriptTag }}>
        <Typography.Text code>{scriptTag}</Typography.Text>
      </Typography.Paragraph>

      <Typography.Paragraph strong style={{ marginBottom: 4 }}>
        2. Activate it in <Typography.Text code>src/config/pixelConfig.ts</Typography.Text>:
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: pixelConfigLine }}>
        <Typography.Text code>{pixelConfigLine}</Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        The PixelRuntime then activates the <Typography.Text code>google-ratio</Typography.Text> SDK on the
        next page load.
      </Typography.Paragraph>
    </Card>
  );
```
(`scriptUrl` already resolves to `${VITE_API_BASE_URL}/google/sdk/${merchantId}.js` — keep that line as-is. `Script`/`Card`/`Typography` imports unchanged; `scriptUrl` is rendered inside `scriptTag`.)

- [ ] **Step 2: `pnpm verify`**

Run: `pnpm verify`. Expected: green (admin typecheck + build pass; no `<head>` text remains — `grep -n "head" apps/admin-google/src/components/ScriptTagPanel.tsx` returns nothing).

---

### Task 4: `_template` reference admin — same generic install fix

**Files:**
- Modify: `apps/_template-admin/src/components/ScriptTagPanel.tsx`

`_template-admin` is excluded from the pnpm workspace + tsconfig (reference-only — `pnpm verify` does not cover it), so this is an edit + a manual read-back, not a verified build.

- [ ] **Step 1: Apply the same two-step install instructions, generic to `<slug>`**

In `apps/_template-admin/src/components/ScriptTagPanel.tsx`, mirror Task 3 but keep the `_template` slug + the generic `"_template-ratio": {}` activation key:
```tsx
  const scriptTag = `<Script src="${scriptUrl}" strategy="afterInteractive" />`;
  const pixelConfigLine = `"_template-ratio": {},`;

  return (
    <Card
      title="Install on your storefront"
      extra={
        <Typography.Text type="secondary">2 steps — config comes from this app, not env vars</Typography.Text>
      }
    >
      <Typography.Paragraph strong style={{ marginBottom: 4 }}>
        1. Add the script to <Typography.Text code>src/app/layout.tsx</Typography.Text> (with the other pixel SDKs):
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: scriptTag }}>
        <Typography.Text code>{scriptTag}</Typography.Text>
      </Typography.Paragraph>

      <Typography.Paragraph strong style={{ marginBottom: 4 }}>
        2. Activate it in <Typography.Text code>src/config/pixelConfig.ts</Typography.Text>:
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: pixelConfigLine }}>
        <Typography.Text code>{pixelConfigLine}</Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        The PixelRuntime then activates this SDK on the next page load; config is served from this app.
      </Typography.Paragraph>
    </Card>
  );
```
(`scriptUrl` stays `${VITE_API_BASE_URL}/_template/sdk/${merchantId}.js`.)

- [ ] **Step 2: Read-back check**

Run: `grep -n "strategy=\"afterInteractive\"\|_template-ratio\|head" apps/_template-admin/src/components/ScriptTagPanel.tsx`
Expected: the `<Script>` + `_template-ratio` lines present; no `head` match.

- [ ] **Step 3: `pnpm verify`** (sanity — confirms nothing else broke; `_template-admin` itself is not in scope of the build)

Run: `pnpm verify`. Expected: green.

---

## Self-review
- AC "no Pending API in UI" → Task 2. AC "single google-ratio pixel wiring GA4+Ads, register when configured, no double-count" → Task 1. AC "ScriptTagPanel hosted `<Script>` + `google-ratio` pixelConfig, no `<head>`" → Task 3. AC "_template admin updated" → Task 4. AC "tests updated, verify green" → Tasks 1–4 Step-5. AC "served pixel still works via harness" → unchanged delivery (verify + the harness exercises the same bundle).
- No placeholders; commands exact. Names consistent: registration `google-ratio`; pixelConfig key `"google-ratio"` (google) / `"_template-ratio"` (template).
- No backend changes (pixel-status columns/service dormant). No commits (no `.git`).
