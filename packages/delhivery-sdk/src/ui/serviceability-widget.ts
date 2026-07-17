import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { DelhiveryClient, type DelhiveryServiceability, PINCODE_RE } from '../client';
// Type-only: brings the `window.__DELHIVERY__` global declaration into scope.
import type {} from '../config';
import { baseStyles } from './theme';

/** Detail of the composed `serviceability` CustomEvent the widget emits. */
export interface ServiceabilityEventDetail {
  pincode: string;
  result: DelhiveryServiceability;
}

/**
 * `<delhivery-serviceability>` — OPTIONAL drop-in pincode checker (Shadow DOM).
 *
 * Renders a 6-digit PIN input + "Check" button and, after a successful check,
 * the verdict: delivery availability, the EDD band, and a COD-availability
 * badge. Configuration resolves from the `merchant-id` / `api-base` attributes,
 * falling back to the loader-stashed `window.__DELHIVERY__`.
 *
 * On every successful check it dispatches a composed, bubbling
 * `serviceability` `CustomEvent<ServiceabilityEventDetail>` so a host checkout
 * can react (e.g. gate the COD payment option) without touching the DOM.
 */
@customElement('delhivery-serviceability')
export class DelhiveryServiceabilityWidget extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: 360px;
      }
      .dlv-row {
        display: flex;
        gap: 8px;
      }
      input {
        flex: 1;
        min-width: 0;
        font: inherit;
        color: var(--dlv-fg);
        background: var(--dlv-bg);
        border: 1px solid var(--dlv-border);
        border-radius: var(--dlv-radius);
        padding: 8px 12px;
      }
      input:focus {
        outline: 2px solid var(--dlv-primary);
        outline-offset: -1px;
      }
      .dlv-check {
        background: var(--dlv-primary);
        color: #fff;
        border-radius: var(--dlv-radius);
        padding: 8px 16px;
        font-weight: 600;
      }
      .dlv-check[disabled] {
        opacity: 0.6;
        cursor: default;
      }
      .dlv-result {
        margin-top: 10px;
        font-size: 14px;
      }
      .dlv-ok {
        color: var(--dlv-primary);
        font-weight: 600;
      }
      .dlv-muted {
        color: var(--dlv-muted);
        margin: 4px 0 6px;
      }
      .dlv-error {
        color: var(--dlv-danger);
      }
    `,
  ];

  /** Ratio merchant id — falls back to the loader's `window.__DELHIVERY__`. */
  @property({ attribute: 'merchant-id' }) merchantId = '';
  /** Backend origin — falls back to the loader's `window.__DELHIVERY__`. */
  @property({ attribute: 'api-base' }) apiBase = '';
  /** Pincode value (two-way with the input). */
  @property() pincode = '';
  /** Injectable client seam (tests / advanced hosts). */
  @property({ attribute: false }) client?: Pick<DelhiveryClient, 'checkServiceability'>;

  @state() private phase: 'idle' | 'loading' | 'done' | 'error' = 'idle';
  @state() private result: DelhiveryServiceability | null = null;
  @state() private error = '';

  /** Resolve (and memoize) the client from attributes or the loader config. */
  private resolveClient(): Pick<DelhiveryClient, 'checkServiceability'> | null {
    if (this.client) return this.client;
    const cfg = typeof window !== 'undefined' ? window.__DELHIVERY__ : undefined;
    const merchantId = this.merchantId || cfg?.merchantId || '';
    const apiBase = this.apiBase || cfg?.apiBase || '';
    if (!merchantId || !apiBase) return null;
    this.client = new DelhiveryClient({ apiBase, merchantId });
    return this.client;
  }

  /** Run the serviceability check for the current pincode. */
  async check(): Promise<void> {
    const pin = this.pincode.trim();
    if (!PINCODE_RE.test(pin)) {
      this.phase = 'error';
      this.result = null;
      this.error = 'Enter a valid 6-digit PIN code';
      return;
    }
    const client = this.resolveClient();
    if (!client) {
      this.phase = 'error';
      this.error = 'Serviceability is not configured for this store';
      return;
    }
    this.phase = 'loading';
    this.error = '';
    try {
      const result = await client.checkServiceability(pin);
      this.result = result;
      this.phase = 'done';
      this.dispatchEvent(
        new CustomEvent<ServiceabilityEventDetail>('serviceability', {
          detail: { pincode: pin, result },
          bubbles: true,
          composed: true,
        }),
      );
    } catch {
      // Soft failure — checkout must never break because of this widget.
      this.result = null;
      this.phase = 'error';
      this.error = 'Could not check delivery for this PIN code. Please try again.';
    }
  }

  private onInput(e: Event): void {
    this.pincode = (e.target as HTMLInputElement).value;
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.check();
    }
  }

  private renderResult() {
    if (this.phase === 'error') return html`<p class="dlv-result dlv-error">${this.error}</p>`;
    if (this.phase !== 'done' || !this.result) return nothing;
    const r = this.result;
    if (!r.serviceable) {
      return html`<p class="dlv-result dlv-error">
        Sorry, delivery is not available to this PIN code.
      </p>`;
    }
    return html`
      <div class="dlv-result">
        <span class="dlv-ok">Delivery available</span>
        <p class="dlv-muted">Estimated delivery: ${r.edd_min}–${r.edd_max} days</p>
        ${
          r.cod_available
            ? html`<span class="dlv-badge dlv-badge--ok">COD available</span>`
            : html`<span class="dlv-badge">Prepaid only</span>`
        }
      </div>
    `;
  }

  override render() {
    return html`
      <div class="dlv-row">
        <input
          type="text"
          inputmode="numeric"
          autocomplete="postal-code"
          maxlength="6"
          placeholder="Enter PIN code"
          aria-label="Delivery PIN code"
          .value=${this.pincode}
          @input=${this.onInput}
          @keydown=${this.onKeydown}
        />
        <button
          class="dlv-check"
          ?disabled=${this.phase === 'loading'}
          @click=${() => void this.check()}
        >
          ${this.phase === 'loading' ? 'Checking…' : 'Check'}
        </button>
      </div>
      <div class="dlv-out" aria-live="polite">${this.renderResult()}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'delhivery-serviceability': DelhiveryServiceabilityWidget;
  }
}
