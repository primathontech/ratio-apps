import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { baseStyles } from './theme';

/**
 * `<wizzy-facet-range>` — a numeric min/max range facet.
 *
 * Renders a label and two number inputs. On either input changing, both values
 * are re-read (empty → undefined) and a `wizzy-facet-change` event is dispatched
 * with `{ key, range }`, where `range` includes only the defined bounds.
 *
 * Standalone: used only by the lazy-loaded results page.
 */
@customElement('wizzy-facet-range')
export class WizzyFacetRange extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .wz-fr-label {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 8px;
      }
      .wz-fr-inputs {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .wz-fr-inputs input {
        width: 100%;
        min-width: 0;
        font: inherit;
        padding: 6px 8px;
        border: 1px solid var(--wz-border);
        border-radius: var(--wz-radius);
        color: var(--wz-fg);
        background: var(--wz-bg);
      }
      .wz-fr-sep {
        color: var(--wz-muted);
      }
    `,
  ];

  @property() facetKey = '';
  @property() label = '';
  @state() private gte: number | undefined;
  @state() private lte: number | undefined;

  private parse(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }

  private onMin(e: Event) {
    this.gte = this.parse((e.target as HTMLInputElement).value);
    this.emit();
  }

  private onMax(e: Event) {
    this.lte = this.parse((e.target as HTMLInputElement).value);
    this.emit();
  }

  private emit() {
    const range: { gte?: number; lte?: number } = {};
    if (this.gte !== undefined) range.gte = this.gte;
    if (this.lte !== undefined) range.lte = this.lte;
    this.dispatchEvent(
      new CustomEvent('wizzy-facet-change', {
        detail: { key: this.facetKey, range },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="wz-fr-label">${this.label}</div>
      <div class="wz-fr-inputs">
        <input type="number" placeholder="Min" @change=${(e: Event) => this.onMin(e)} />
        <span class="wz-fr-sep">–</span>
        <input type="number" placeholder="Max" @change=${(e: Event) => this.onMax(e)} />
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wizzy-facet-range': WizzyFacetRange;
  }
}
