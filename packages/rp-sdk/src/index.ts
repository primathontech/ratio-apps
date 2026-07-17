import { startAutoInject } from './auto-inject';
import { scriptConfig } from './loader';
import { syncReturnPrimePage } from './return-prime-page';

export { scriptConfig } from './loader';
export { RpReturnPortal } from './portal';
export { RpReturnButton } from './return-button';
export type { RpConfig, RpLineItem, RpOrder, RpReason, SelectedItem } from './types';

// Zero-markup global mode: `?floating=1` on the script src injects a single fixed
// bottom-right button on every page (no order context — RP's own lookup screen
// collects order/email). For storefronts that don't want per-page auto-detection.
function injectFloatingButton(): void {
  const el = document.createElement('rp-return-button');
  el.setAttribute('floating', '');
  document.body.appendChild(el);
}

function bootstrap(): void {
  // Mutually exclusive with the button placements below — a page is either the returns
  // page or an order page, never both — so this always runs alongside whichever mode.
  void syncReturnPrimePage();
  if (scriptConfig.floating) {
    injectFloatingButton();
  } else {
    startAutoInject();
  }
}

if (typeof document !== 'undefined' && scriptConfig.store && scriptConfig.adapterUrl) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
}

export function initReturnPortal(config: {
  store: string;
  apiUrl: string;
  targetSelector?: string;
  channel?: number;
  primaryColor?: string;
}): void {
  const target = document.querySelector(config.targetSelector ?? '#rp-return-portal');
  if (!target) {
    console.warn(
      '[rp-sdk] No target element found. Add <div id="rp-return-portal"></div> to your page.',
    );
    return;
  }

  const el = document.createElement('rp-return-portal');
  el.setAttribute('store', config.store);
  el.setAttribute('api-url', config.apiUrl);
  if (config.channel !== undefined) el.setAttribute('channel', String(config.channel));
  if (config.primaryColor) el.setAttribute('primary-color', config.primaryColor);

  target.replaceWith(el);
}
