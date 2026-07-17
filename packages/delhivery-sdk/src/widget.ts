// ESM widget bundle entry — lazily injected by the loader ONLY when a page
// actually uses the optional `<delhivery-serviceability>` element. Importing
// the component registers the custom element; already-parsed elements upgrade
// in place. The headless `window.RatioDelhivery` client lives in the loader
// bundle and does NOT depend on this file.
import './ui/serviceability-widget';

export type { ServiceabilityEventDetail } from './ui/serviceability-widget';
export { DelhiveryServiceabilityWidget } from './ui/serviceability-widget';
