import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { scriptConfig, compilePathPattern } = vi.hoisted(() => {
  // Re-implemented here (not imported) since vi.mock replaces the whole module — matches
  // loader.ts's real implementation exactly.
  function compilePathPattern(template: string): RegExp {
    const escaped = template
      .split('/')
      .map((seg) => (seg === ':id' ? '([^/?]+)' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/');
    return new RegExp(`^${escaped}/?$`);
  }
  return {
    compilePathPattern,
    scriptConfig: {
      store: 'test-store',
      adapterUrl: 'https://adapter.example.com',
      floating: false,
      orderDetailPath: '/pages/orders/:id',
      orderListPath: '/pages/orders',
      redirectTo: '',
      returnPrimePath: '/apps/return_prime',
    },
  };
});
vi.mock('./loader', () => ({ scriptConfig, compilePathPattern }));

function setPathname(pathname: string) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname, search: '' },
  });
}

// startAutoInject() has global, cumulative, one-time side effects (customElements.define,
// wrapping history.pushState/replaceState, a document-wide MutationObserver) — it must only
// ever be called ONCE across this whole file, not per-test, or a second call either throws
// (redefining the custom element) or double-wraps history. Import + start once here; each
// test just manipulates the DOM/history and asserts against the single already-running instance.
beforeAll(async () => {
  const { startAutoInject } = await import('./auto-inject');
  startAutoInject();
});

describe('auto-inject — list page stale order-id', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    setPathname('/pages/orders');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects a return button next to a row link with the correct order-id', async () => {
    const link = document.createElement('a');
    link.href = '/pages/orders/123';
    document.body.appendChild(link);

    // Trigger a fresh sync for this test's DOM via a history event (already-installed listener).
    history.pushState({}, '', '/pages/orders');
    await vi.advanceTimersByTimeAsync(120);

    const button = link.nextElementSibling;
    expect(button?.tagName).toBe('RP-RETURN-BUTTON');
    expect(button?.getAttribute('order-id')).toBe('123');
  });

  it('updates a stale button when the row link is reused in place with a different href (e.g. unkeyed list reconciliation on reorder/pagination)', async () => {
    const link = document.createElement('a');
    link.href = '/pages/orders/123';
    document.body.appendChild(link);

    history.pushState({}, '', '/pages/orders');
    await vi.advanceTimersByTimeAsync(120);

    const firstButton = link.nextElementSibling;
    expect(firstButton?.getAttribute('order-id')).toBe('123');

    // Simulate the framework reusing the SAME <a> node in place, just changing its href —
    // the button is never touched by this DOM mutation directly.
    link.href = '/pages/orders/456';
    history.pushState({}, '', '/pages/orders');
    await vi.advanceTimersByTimeAsync(120);

    const updatedButton = link.nextElementSibling;
    expect(updatedButton?.tagName).toBe('RP-RETURN-BUTTON');
    expect(updatedButton?.getAttribute('order-id')).toBe('456');
  });

  it('leaves the button alone when the href is unchanged (no unnecessary remove/recreate)', async () => {
    const link = document.createElement('a');
    link.href = '/pages/orders/123';
    document.body.appendChild(link);

    history.pushState({}, '', '/pages/orders');
    await vi.advanceTimersByTimeAsync(120);
    const firstButton = link.nextElementSibling;

    history.pushState({}, '', '/pages/orders');
    await vi.advanceTimersByTimeAsync(120);

    expect(link.nextElementSibling).toBe(firstButton);
  });
});
