// TEMPLATE: Lit `<forms-results-page>` component. Customize the custom-element tag and the search/facet result shapes to match this vendor.
import type { FormsFacet, FormsProduct } from '@ratio-app/shared';
import { css, html, LitElement, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { CommonFilter, FormsClient } from '../client';
import './facet-list';
import './facet-range';
import './product-card';
import { baseStyles, themeVars } from './theme';

/**
 * `<forms-results-page>` — the full search results page.
 *
 * Runs an initial search for `query`, renders a faceted sidebar (list/range)
 * built from the response facets + `filterSuggestions`, and a product grid.
 * Facet changes (via the bubbling `forms-facet-change` event) are assembled
 * into a Forms CommonFilter model and re-applied through `client.filter`.
 *
 * Ships as its own ESM bundle (`dist/forms-results.js`) injected by the loader
 * on the results route — it is NOT part of the overlay widget graph.
 */
@customElement('forms-results-page')
export class FormsResultsPage extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .wz-rp {
        display: grid;
        grid-template-columns: 240px 1fr;
        gap: 24px;
        max-width: 1200px;
        margin: 0 auto;
        padding: 16px;
      }
      .wz-rp-side {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .wz-rp-main {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .wz-rp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .wz-rp-total {
        font-weight: 600;
        font-size: 15px;
      }
      .wz-rp-sort {
        font: inherit;
        padding: 6px 8px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        background: var(--wz-bg);
        color: var(--wz-fg);
      }
      .wz-rp-pager {
        display: flex;
        align-items: center;
        gap: 12px;
        justify-content: center;
        padding-top: 8px;
      }
      .wz-rp-pager button {
        padding: 6px 14px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
      }
      .wz-rp-pager button[disabled] {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ];

  @property({ attribute: false }) client!: FormsClient;
  @property() query = '';
  @property() themePrimary = '#0fb3a9';

  @state() private products: FormsProduct[] = [];
  @state() private total = 0;
  @state() private pages = 0;
  @state() private facets: FormsFacet[] = [];
  @state() private filterSuggestions: Record<string, unknown> = {};
  @state() private selected: Record<string, string[]> = {};
  @state() private ranges: Record<string, { gte?: number; lte?: number }> = {};

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('forms-facet-change', this.onFacetChange as EventListener);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('forms-facet-change', this.onFacetChange as EventListener);
    super.disconnectedCallback();
  }

  /** Run the initial keyword search and seed products/facets/suggestions. */
  async runSearch(): Promise<void> {
    const r = await this.client.search(this.query, { productsCount: 24 });
    this.products = r.payload.result;
    this.total = r.payload.total;
    this.pages = r.payload.pages;
    this.facets = r.payload.facets;
    this.filterSuggestions = (r.payload.filterSuggestions ?? {}) as Record<string, unknown>;
    this.client.event('view', { query: this.query });
  }

  override firstUpdated(): void {
    void this.runSearch();
  }

  private onFacetChange = (e: Event): void => {
    const d = (e as CustomEvent).detail as {
      key: string;
      selected?: string[];
      range?: { gte?: number; lte?: number };
    };
    if (d.selected) this.selected = { ...this.selected, [d.key]: d.selected };
    if (d.range) this.ranges = { ...this.ranges, [d.key]: d.range };
    void this.applyFilters();
  };

  private buildFilterModel(): CommonFilter {
    const model: CommonFilter = {};
    for (const key of Object.keys(this.selected)) {
      const values = this.selected[key];
      if (values && values.length > 0) model[key] = values;
    }
    for (const key of Object.keys(this.ranges)) {
      const range = this.ranges[key];
      if (range) model[key] = [range];
    }
    return model;
  }

  private async applyFilters(): Promise<void> {
    const r = await this.client.filter(this.buildFilterModel(), { q: this.query });
    this.products = r.payload.result;
    this.total = r.payload.total;
    this.pages = r.payload.pages;
  }

  private renderFacet(f: FormsFacet) {
    if (f.type === 'range') {
      return html`<forms-facet-range .facetKey=${f.key} .label=${f.label}></forms-facet-range>`;
    }
    return html`<forms-facet-list
      .facetKey=${f.key}
      .label=${f.label}
      .values=${(this.filterSuggestions[f.key] as string[]) ?? []}
      .selected=${this.selected[f.key] ?? []}
    ></forms-facet-list>`;
  }

  override render() {
    const sideFacets = this.facets.filter((f) => f.position !== 'top');
    return html`
      <style>
        ${unsafeCSS(themeVars({ primary: this.themePrimary }))}
      </style>
      <div class="wz-rp">
        <aside class="wz-rp-side">${sideFacets.map((f) => this.renderFacet(f))}</aside>
        <section class="wz-rp-main">
          <div class="wz-rp-head">
            <span class="wz-rp-total">${this.total} results</span>
            <select class="wz-rp-sort">
              <option value="relevance">Relevance</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
            </select>
          </div>
          <div class="wz-grid">
            ${this.products.map(
              (p) => html`<forms-product-card
                .product=${p}
                @click=${() => this.client.event('click', { productId: p.id, query: this.query })}
              ></forms-product-card>`,
            )}
          </div>
          <div class="wz-rp-pager">
            <button type="button" ?disabled=${this.pages <= 1}>Prev</button>
            <button type="button" ?disabled=${this.pages <= 1}>Next</button>
          </div>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'forms-results-page': FormsResultsPage;
  }
}
