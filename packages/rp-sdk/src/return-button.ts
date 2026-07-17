import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fetchEnabled } from './enabled-check';
import { scriptConfig } from './loader';
import { baseStyles } from './ui/theme';

/**
 * Drop-in "Return / Exchange" entry point for any storefront. Owns everything the
 * old per-storefront integration hand-rolled: the enable/disable check against the
 * adapter, the button, and an iframe modal that opens RP's OWN hosted customer
 * portal (via the adapter's /rp/customer/portal redirect — the storefront never
 * needs to know RP's URL, and no RP UI is reimplemented here).
 *
 * Merchant usage (attributes fall back to the script-tag defaults set by the
 * loader in index.ts, so per-element markup stays minimal):
 *   <rp-return-button order="ORD-123" email="c@x.com"></rp-return-button>
 *
 * `floating` renders a fixed bottom-right pill instead of an inline button —
 * the zero-markup mode auto-injected by the loader (`?floating=1`), no prefill.
 */
@customElement('rp-return-button')
export class RpReturnButton extends LitElement {
  /** Script-tag-level defaults — parsed by loader.ts before define(). */
  static defaults: { store: string; adapterUrl: string; redirectTo: string } = {
    store: scriptConfig.store,
    adapterUrl: scriptConfig.adapterUrl,
    redirectTo: scriptConfig.redirectTo,
  };

  static override styles = [
    baseStyles,
    css`
      :host { display: inline-block; }
      :host([floating]) {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147482999;
      }
      .rp-btn-floating {
        border-radius: 999px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        padding: 12px 22px;
      }
      /* Auto-injected inline placements sit next to a storefront's own plain-text
       * actions (e.g. a "View" link) — a bold filled CTA looks like a rendering bug
       * there. Match that visual weight instead: a small underlined text link. */
      .rp-btn-inline-link {
        display: inline;
        width: auto;
        background: none;
        color: var(--rp-primary);
        padding: 0;
        margin-left: 10px;
        font-size: 13px;
        font-weight: 500;
        text-decoration: underline;
        text-underline-offset: 4px;
      }
      .rp-btn-inline-link:hover {
        background: none;
        color: var(--rp-primary-hover);
      }
      .rp-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      .rp-modal {
        position: relative;
        width: 100%;
        max-width: 720px;
        height: 85vh;
        background: var(--rp-bg);
        border-radius: var(--rp-radius);
        overflow: hidden;
      }
      .rp-modal iframe {
        width: 100%;
        height: 100%;
        border: 0;
      }
      .rp-close {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 1;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background: var(--rp-surface);
        color: var(--rp-text, #111827);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
    `,
  ];

  /** RP store identifier (RP's store_url — not necessarily the storefront's own domain). */
  @property() store = '';
  /** Adapter base URL. Normally inherited from where the SDK script was loaded from. */
  @property({ attribute: 'adapter-url' }) adapterUrl = '';
  @property() order = '';
  @property() email = '';
  /** Raw OS order id (e.g. "ordr_XXXX") — the adapter resolves this to order name +
   *  email server-side, so callers that only know the id (from a URL/DOM, not app
   *  state) never need to fetch/pass those explicitly. Ignored if `order` is set. */
  @property({ attribute: 'order-id' }) orderId = '';
  @property({ attribute: 'button-label' }) buttonLabel = 'Return / Exchange';
  @property({ type: Boolean, reflect: true }) floating = false;
  /** Opt-in: navigate here instead of opening the iframe modal (e.g. a storefront's own
   *  chrome-wrapped returns page). Falls back to the script-tag default; empty by default
   *  (modal), since most storefronts don't have such a page. */
  @property({ attribute: 'redirect-to' }) redirectTo = '';

  @state() private enabled = false;
  @state() private open = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.store) this.store = RpReturnButton.defaults.store;
    if (!this.adapterUrl) this.adapterUrl = RpReturnButton.defaults.adapterUrl;
    if (!this.redirectTo) this.redirectTo = RpReturnButton.defaults.redirectTo;
    void this.checkEnabled();
  }

  /**
   * Merchant enable/disable toggle (RP admin → adapter /rp/config). Fails CLOSED —
   * `enabled` stays false on any error, so an adapter outage hides the button rather
   * than surfacing a dead entry point on every storefront page.
   */
  private async checkEnabled(): Promise<void> {
    if (!this.adapterUrl || !this.store) return;
    this.enabled = await fetchEnabled(this.adapterUrl, this.store);
  }

  private get orderParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.order) {
      params.set('order', this.order);
      if (this.email) params.set('email', this.email);
    } else if (this.orderId) {
      params.set('orderId', this.orderId);
    }
    return params;
  }

  /**
   * The adapter's portal redirect resolves the actual RP URL per environment
   * (RP_PORTAL_URL in dev, RP's hosted shell in prod) — the iframe just follows it.
   */
  private get portalUrl(): string {
    const params = this.orderParams;
    params.set('shop', this.store);
    return `${this.adapterUrl.replace(/\/$/, '')}/rp/customer/portal?${params.toString()}`;
  }

  private handleClick(): void {
    if (this.redirectTo) {
      const qs = this.orderParams.toString();
      window.location.href = qs ? `${this.redirectTo}?${qs}` : this.redirectTo;
      return;
    }
    this.open = true;
  }

  override render() {
    if (!this.enabled) return nothing;

    return html`
      <button
        class="rp-btn ${this.floating ? 'rp-btn-primary rp-btn-floating' : 'rp-btn-inline-link'}"
        @click=${() => this.handleClick()}
      >
        ${this.buttonLabel}
      </button>

      ${
        this.open
          ? html`
            <div class="rp-overlay" @click=${() => {
              this.open = false;
            }}>
              <div class="rp-modal" @click=${(e: Event) => e.stopPropagation()}>
                <button class="rp-close" aria-label="Close" @click=${() => {
                  this.open = false;
                }}>
                  &times;
                </button>
                <iframe src=${this.portalUrl} title="Returns & Exchanges"></iframe>
              </div>
            </div>
          `
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rp-return-button': RpReturnButton;
  }
}
