// TEMPLATE: Lit `<forms-facet-list>` component. Customize the custom-element tag and the facet shape to match this vendor.
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { baseStyles } from './theme';

/**
 * `<forms-facet-list>` — a multi-select checkbox facet.
 *
 * Renders a label and one checkbox per value. Toggling a checkbox recomputes
 * the selection (preserving the original `values` order) and dispatches a
 * `forms-facet-change` event with `{ key, selected }`.
 *
 * Standalone: used only by the lazy-loaded results page.
 */
@customElement('forms-facet-list')
export class FormsFacetList extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .wz-fl-label {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 8px;
      }
      .wz-fl-opt {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        padding: 4px 0;
        cursor: pointer;
      }
      .wz-fl-opt input {
        accent-color: var(--wz-primary);
      }
      .wz-fl-opts {
        display: flex;
        flex-direction: column;
      }
    `,
  ];

  @property() facetKey = '';
  @property() label = '';
  @property({ attribute: false }) values: string[] = [];
  @property({ attribute: false }) selected: string[] = [];

  private onToggle(value: string, checked: boolean) {
    const next = new Set(this.selected);
    if (checked) {
      next.add(value);
    } else {
      next.delete(value);
    }
    const selected = this.values.filter((v) => next.has(v));
    this.dispatchEvent(
      new CustomEvent('forms-facet-change', {
        detail: { key: this.facetKey, selected },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="wz-fl-label">${this.label}</div>
      <div class="wz-fl-opts">
        ${this.values.map(
          (value) => html`
            <label class="wz-fl-opt">
              <input
                type="checkbox"
                .value=${value}
                .checked=${this.selected.includes(value)}
                @change=${(e: Event) =>
                  this.onToggle(value, (e.target as HTMLInputElement).checked)}
              />
              <span>${value}</span>
            </label>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'forms-facet-list': FormsFacetList;
  }
}
