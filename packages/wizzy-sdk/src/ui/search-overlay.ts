import type { WizzyProduct, WizzySuggestion } from '@ratio-app/shared';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { WizzyClient } from '../client';
import type { RecentStore } from '../recent-store';
import './product-card';
import { baseStyles, themeVars } from './theme';

/**
 * `<wizzy-search-overlay>` — the search dropdown rendered beneath a storefront's
 * search input.
 *
 * Two display states:
 * - **Empty** (no query): RECENT SEARCHES chips, TRENDING SEARCHES chips, and a
 *   TOP PRODUCTS grid seeded from the top trending query.
 * - **Typing** (query present): a left column of CATEGORIES + suggestions and a
 *   right column TOP PRODUCTS grid, both from the autocomplete response.
 *
 * Picking a chip/category or submitting fires a composed `wizzy-submit`
 * `CustomEvent<{ q: string }>`; the widget entry handles navigation.
 */
@customElement('wizzy-search-overlay')
export class WizzySearchOverlay extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        width: 100%;
        max-width: 720px;
      }
      :host(:not([open])) {
        display: none;
      }
      .wz-panel {
        background: var(--wz-bg);
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
        padding: 16px;
        max-height: 70vh;
        overflow: auto;
      }
      .wz-cols {
        display: grid;
        grid-template-columns: minmax(180px, 240px) 1fr;
        gap: 20px;
      }
      .wz-section + .wz-section {
        margin-top: 16px;
      }
      .wz-heading {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--wz-muted);
        margin: 0 0 8px;
      }
      .wz-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .wz-chip {
        border: 1px solid var(--wz-border);
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 13px;
        background: var(--wz-bg);
      }
      .wz-chip:hover {
        border-color: var(--wz-primary);
        color: var(--wz-primary);
      }
      .wz-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .wz-list-item {
        text-align: left;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 14px;
      }
      .wz-list-item:hover {
        background: rgba(0, 0, 0, 0.04);
        color: var(--wz-primary);
      }
      .wz-visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ];

  @property({ attribute: false }) client!: WizzyClient;
  @property({ attribute: false }) recent!: RecentStore;
  @property({ type: Boolean, reflect: true }) open = false;
  @property() themePrimary = '#0fb3a9';

  @state() private query = '';
  @state() private categories: WizzySuggestion[] = [];
  @state() private suggestions: WizzySuggestion[] = [];
  @state() private products: WizzyProduct[] = [];
  @state() private trending: string[] = [];

  #debounce?: ReturnType<typeof setTimeout>;
  private DEBOUNCE_MS = 180;

  /** Reset to the empty state and fetch trending queries + their top products. */
  async loadEmptyState(): Promise<void> {
    this.query = '';
    this.categories = [];
    this.suggestions = [];
    try {
      this.trending = (await this.client.trending(6)).payload.queries.map((q) => String(q));
      const top = this.trending[0];
      if (top) {
        this.products = (
          await this.client.autocomplete(top, { productsCount: 6 })
        ).payload.products;
      }
    } catch {
      /* ignore */
    }
  }

  /** Handle a keystroke: debounce-fetch autocomplete, or reset when cleared. */
  onInput(value: string): void {
    this.query = value;
    this.open = true;
    clearTimeout(this.#debounce);
    if (!value.trim()) {
      void this.loadEmptyState();
      return;
    }
    this.#debounce = setTimeout(() => void this.fetchAutocomplete(value), this.DEBOUNCE_MS);
  }

  private async fetchAutocomplete(q: string): Promise<void> {
    try {
      const r = await this.client.autocomplete(q, { productsCount: 6 });
      this.categories = r.payload.categories;
      this.suggestions = [...r.payload.others, ...r.payload.brands];
      this.products = r.payload.products;
    } catch {
      /* ignore (abort) */
    }
  }

  /** Fire a composed `wizzy-submit` event with the trimmed query and close. */
  submit(q: string): void {
    const t = q.trim();
    if (!t) return;
    this.dispatchEvent(
      new CustomEvent('wizzy-submit', { detail: { q: t }, bubbles: true, composed: true }),
    );
    this.open = false;
  }

  override firstUpdated(): void {
    void this.loadEmptyState();
  }

  private renderProducts(): unknown {
    if (this.products.length === 0) return null;
    return html`
      <div class="wz-section">
        <p class="wz-heading">Top Products</p>
        <div class="wz-grid">
          ${this.products.map(
            (p) => html`
              <div class="wz-prod">
                <wizzy-product-card .product=${p}></wizzy-product-card>
                <span class="wz-visually-hidden">${p.name}</span>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderEmpty(): unknown {
    const recent = this.recent.list();
    return html`
      <div class="wz-cols">
        <div>
          ${
            recent.length > 0
              ? html`
                <div class="wz-section">
                  <p class="wz-heading">Recent Searches</p>
                  <div class="wz-chips">
                    ${recent.map(
                      (item) =>
                        html`<button class="wz-chip" @click=${() => this.submit(item)}>
                          ${item}
                        </button>`,
                    )}
                  </div>
                </div>
              `
              : null
          }
          ${
            this.trending.length > 0
              ? html`
                <div class="wz-section">
                  <p class="wz-heading">Trending Searches</p>
                  <div class="wz-chips">
                    ${this.trending.map(
                      (item) =>
                        html`<button class="wz-chip" @click=${() => this.submit(item)}>
                          ${item}
                        </button>`,
                    )}
                  </div>
                </div>
              `
              : null
          }
        </div>
        <div>${this.renderProducts()}</div>
      </div>
    `;
  }

  private renderTyping(): unknown {
    return html`
      <div class="wz-cols">
        <div>
          ${
            this.categories.length > 0
              ? html`
                <div class="wz-section">
                  <p class="wz-heading">Categories</p>
                  <div class="wz-list">
                    ${this.categories.map(
                      (c) =>
                        html`<button class="wz-list-item" @click=${() => this.submit(c.value)}>
                          ${c.value}
                        </button>`,
                    )}
                  </div>
                </div>
              `
              : null
          }
          ${
            this.suggestions.length > 0
              ? html`
                <div class="wz-section">
                  <p class="wz-heading">Suggestions</p>
                  <div class="wz-list">
                    ${this.suggestions.map(
                      (s) =>
                        html`<button class="wz-list-item" @click=${() => this.submit(s.value)}>
                          ${s.value}
                        </button>`,
                    )}
                  </div>
                </div>
              `
              : null
          }
        </div>
        <div>${this.renderProducts()}</div>
      </div>
    `;
  }

  override render() {
    return html`
      <style>
        ${themeVars({ primary: this.themePrimary })}
      </style>
      <div class="wz-panel">${this.query ? this.renderTyping() : this.renderEmpty()}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wizzy-search-overlay': WizzySearchOverlay;
  }
}
