import type { WizzyProduct } from '@ratio-app/shared';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { baseStyles } from './theme';

/** INR currency formatter — renders e.g. `₹588` (no fraction digits). */
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * `<wizzy-product-card>` — a single search-result product tile.
 *
 * Renders an image, name, final price, and (when discounted) a struck MRP plus
 * a discount badge, all wrapped in an anchor to the product URL.
 */
@customElement('wizzy-product-card')
export class WizzyProductCard extends LitElement {
  static override styles = [
    baseStyles,
    css`
      a {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .wz-pc-img {
        aspect-ratio: 1 / 1;
        width: 100%;
        object-fit: cover;
        background: var(--wz-border);
      }
      .wz-pc-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px;
      }
      .wz-pc-name {
        font-size: 13px;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .wz-pc-prices {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px;
      }
      .wz-pc-final {
        font-weight: 600;
        color: var(--wz-fg);
      }
      .wz-pc-mrp {
        color: var(--wz-muted);
        font-size: 12px;
      }
      .wz-pc-off {
        color: var(--wz-primary);
        font-size: 12px;
        font-weight: 600;
      }
    `,
  ];

  @property({ attribute: false }) product!: WizzyProduct;

  override render() {
    const p = this.product;
    const discounted = p.finalPrice < p.price;
    return html`
      <a class="wz-card" href=${p.url}>
        <img
          class="wz-pc-img"
          src=${p.mainImage}
          alt=${p.name}
          loading="lazy"
        />
        <div class="wz-pc-body">
          <span class="wz-pc-name">${p.name}</span>
          <div class="wz-pc-prices">
            <span class="wz-pc-final">${inr.format(p.finalPrice)}</span>
            ${discounted ? html`<s class="wz-pc-mrp">${inr.format(p.price)}</s>` : null}
            ${
              discounted && p.discountPercentage !== undefined
                ? html`<span class="wz-pc-off">${p.discountPercentage}% off</span>`
                : null
            }
          </div>
        </div>
      </a>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wizzy-product-card': WizzyProductCard;
  }
}
