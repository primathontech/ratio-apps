/**
 * Widget entry (`forms-widget.js`) — the bundle the backend appends to the
 * per-merchant SDK response after the `window.__FORMS_SDK_CONFIG__` prelude.
 *
 * Registers the `<ratio-form>` custom element and upgrades every
 * `[data-ratio-form]` mount on the page.
 */
import { bootForms } from './loader';
import './ui/form-renderer';

if (typeof window !== 'undefined' && window.__FORMS_SDK_CONFIG__) {
  bootForms();
}
