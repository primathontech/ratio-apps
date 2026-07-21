import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  createRequest,
  createSession,
  findOrder,
  getReasons,
  searchExchangeProducts,
} from './client';
import type {
  RpConfig,
  RpExchangeProduct,
  RpLineItem,
  RpOrder,
  RpReason,
  SelectedItem,
} from './types';
import { baseStyles } from './ui/theme';

type Screen = 'lookup' | 'loading' | 'items' | 'reasons' | 'submitting' | 'success' | 'error';

@customElement('rp-return-portal')
export class RpReturnPortal extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding: 16px;
      }
      .rp-item-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid var(--rp-border);
      }
      .rp-item-row:last-child { border-bottom: none; }
      .rp-item-check {
        margin-top: 2px;
        width: 16px;
        height: 16px;
        accent-color: var(--rp-primary);
        cursor: pointer;
        flex-shrink: 0;
      }
      .rp-item-info { flex: 1; min-width: 0; }
      .rp-item-title {
        font-weight: 500;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rp-item-meta {
        font-size: 12px;
        color: var(--rp-muted);
        margin-top: 2px;
      }
      .rp-item-price {
        font-size: 14px;
        font-weight: 500;
        flex-shrink: 0;
      }
      .rp-reason-block {
        border: 1px solid var(--rp-border);
        border-radius: var(--rp-radius);
        padding: 14px;
        margin-bottom: 12px;
      }
      .rp-reason-block-title {
        font-weight: 500;
        margin-bottom: 10px;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rp-radio-group { display: flex; flex-direction: column; gap: 6px; }
      .rp-radio-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        cursor: pointer;
      }
      .rp-radio-label input { accent-color: var(--rp-primary); }
      .rp-select {
        display: block;
        width: 100%;
        padding: 9px 12px;
        border: 1px solid var(--rp-border);
        border-radius: 6px;
        font-size: 14px;
        background: var(--rp-bg);
        color: var(--rp-text, #111827);
        outline: none;
        margin-top: 10px;
      }
      .rp-select:focus { border-color: var(--rp-primary); }
      .rp-success-icon {
        width: 56px;
        height: 56px;
        background: color-mix(in srgb, var(--rp-success) 12%, transparent);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        margin-bottom: 8px;
      }
      .rp-serial {
        font-size: 22px;
        font-weight: 700;
        color: var(--rp-primary);
        margin: 4px 0 8px;
      }
      .rp-textarea {
        display: block;
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--rp-border);
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
        resize: vertical;
        min-height: 60px;
        outline: none;
        margin-top: 8px;
        background: var(--rp-bg);
        color: var(--rp-text, #111827);
      }
      .rp-textarea:focus { border-color: var(--rp-primary); }
      .rp-refund-section { margin-top: 10px; }
      .rp-refund-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--rp-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 6px;
      }
      /* Exchange product picker — PLP-style grid */
      .rp-plp { margin-top: 12px; }
      .rp-plp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 10px;
        margin-top: 8px;
      }
      .rp-plp-card {
        display: flex;
        flex-direction: column;
        text-align: left;
        padding: 0;
        border: 1px solid var(--rp-border);
        border-radius: var(--rp-radius);
        background: var(--rp-bg);
        cursor: pointer;
        overflow: hidden;
        transition: border-color 0.15s, box-shadow 0.15s;
        font: inherit;
        color: inherit;
      }
      .rp-plp-card:hover { border-color: var(--rp-primary); }
      .rp-plp-card:focus-visible {
        outline: 2px solid var(--rp-primary);
        outline-offset: 1px;
      }
      .rp-plp-card.selected {
        border-color: var(--rp-primary);
        box-shadow: 0 0 0 1px var(--rp-primary) inset;
      }
      .rp-plp-thumb {
        width: 100%;
        aspect-ratio: 1 / 1;
        object-fit: cover;
        background: color-mix(in srgb, var(--rp-muted) 12%, transparent);
        display: block;
      }
      .rp-plp-thumb--empty {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--rp-muted);
        font-size: 22px;
      }
      .rp-plp-body { padding: 8px 10px; }
      .rp-plp-title {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .rp-plp-price {
        font-size: 13px;
        font-weight: 600;
        margin-top: 4px;
        color: var(--rp-primary);
      }
      .rp-plp-check {
        position: relative;
      }
      .rp-plp-badge {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--rp-primary);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        line-height: 1;
      }
      .rp-variant-row { margin-top: 12px; }
      .rp-variant-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 6px;
      }
      .rp-chip {
        padding: 6px 12px;
        border: 1px solid var(--rp-border);
        border-radius: 999px;
        background: var(--rp-bg);
        color: inherit;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }
      .rp-chip:hover:not([disabled]) { border-color: var(--rp-primary); }
      .rp-chip.selected {
        border-color: var(--rp-primary);
        background: color-mix(in srgb, var(--rp-primary) 12%, transparent);
        font-weight: 600;
      }
      .rp-chip[disabled] {
        opacity: 0.45;
        cursor: not-allowed;
        text-decoration: line-through;
      }
    `,
  ];

  @property() store = '';
  @property({ attribute: 'api-url' }) apiUrl = '';
  @property({ type: Number }) channel = 1;
  @property({ attribute: 'primary-color' }) primaryColor = '';

  @state() private screen: Screen = 'lookup';
  @state() private orderInput = '';
  @state() private identifierInput = '';
  @state() private error = '';

  @state() private session = '';
  @state() private order: RpOrder | null = null;
  @state() private lineItems: RpLineItem[] = [];
  @state() private currency = 'INR';
  @state() private reasons: RpReason[] = [];

  @state() private checkedIds = new Set<number>();
  @state() private selections: Map<number, Partial<SelectedItem>> = new Map();
  // Per-item exchange picker state
  @state() private exchangeProducts: Map<number, RpExchangeProduct[]> = new Map();
  @state() private exchangeLoading: Set<number> = new Set();

  @state() private serialNumber = '';

  private get config(): RpConfig {
    return { store: this.store, apiUrl: this.apiUrl, channel: this.channel };
  }

  private fmt(amount: string | number): string {
    const sym = this.currency === 'INR' ? '₹' : this.currency;
    const val = typeof amount === 'string' ? parseFloat(amount) : amount;
    // RP returns prices in major units (rupees), not paise — do NOT divide by 100.
    return `${sym}${(Number.isFinite(val) ? val : 0).toFixed(2)}`;
  }

  // ─── Lookup screen ──────────────────────────────────────────────────────────

  private async handleLookup(e: Event): Promise<void> {
    e.preventDefault();
    const orderVal = this.orderInput.trim();
    const identVal = this.identifierInput.trim();
    if (!orderVal || !identVal) return;

    this.screen = 'loading';
    this.error = '';

    try {
      const token = await createSession(this.config, orderVal, identVal);
      this.session = token;
      const { order, lineItems, currency } = await findOrder(this.config, token);
      this.order = order;
      this.lineItems = lineItems;
      this.currency = currency;

      if (lineItems.length === 0) {
        this.error = 'No items eligible for return on this order.';
        this.screen = 'lookup';
        return;
      }

      this.checkedIds = new Set();
      this.selections = new Map();
      this.screen = 'items';
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : 'Order not found. Please check and try again.';
      this.screen = 'lookup';
    }
  }

  // ─── Item selection screen ───────────────────────────────────────────────────

  private toggleItem(id: number): void {
    const next = new Set(this.checkedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.checkedIds = next;
  }

  private async handleItemsContinue(): Promise<void> {
    if (this.checkedIds.size === 0) return;
    this.screen = 'loading';
    this.error = '';

    const ids = [...this.checkedIds];
    const fetched = await getReasons(this.config, this.session, this.order!.id, ids);
    this.reasons = fetched;

    const initSelections = new Map<number, Partial<SelectedItem>>();
    for (const id of ids) {
      const li = this.lineItems.find((l) => l.id === id);
      if (!li) continue;
      const defaultReason = fetched[0];
      initSelections.set(id, {
        lineItem: li,
        reasonId: defaultReason?._id ?? '',
        reasonText: defaultReason?.reason ?? 'Other',
        refundMode: this.defaultRefundMode(defaultReason),
        comment: '',
        type: 'return',
      });
    }
    this.selections = initSelections;
    this.screen = 'reasons';
  }

  // ─── Reason selection screen ─────────────────────────────────────────────────

  private updateSelection(id: number, patch: Partial<SelectedItem>): void {
    const existing = this.selections.get(id) ?? {};
    this.selections = new Map(this.selections).set(id, { ...existing, ...patch });
  }

  // Pick a refund mode that the reason actually enables — never default to one that
  // won't be shown (e.g. Store Credit on an OS store, which the backend disables).
  private defaultRefundMode(reason?: RpReason): string {
    const p = reason?.refund_mode?.prepaid as Record<string, unknown> | undefined;
    const enabled = ['store_credit', 'pay_to_source', 'bank_transfer'].filter((m) => p?.[m]);
    const def = typeof p?.default === 'string' ? (p.default as string) : '';
    if (def && (enabled.length === 0 || enabled.includes(def))) return def;
    return enabled[0] ?? def ?? 'store_credit';
  }

  private onReasonChange(id: number, reasonId: string): void {
    const reason = this.reasons.find((r) => r._id === reasonId);
    this.updateSelection(id, {
      reasonId,
      reasonText: reason?.reason ?? 'Other',
      refundMode: this.defaultRefundMode(reason),
    });
  }

  private onRefundChange(id: number, refundMode: string): void {
    this.updateSelection(id, { refundMode });
  }

  private async onTypeChange(id: number, type: 'return' | 'exchange'): Promise<void> {
    this.updateSelection(id, { type });
    if (type !== 'exchange') return;
    const sel = this.selections.get(id);
    const li = sel?.lineItem;
    if (!li?.product_id) return;
    // Load exchange-eligible products once, capped at the returned item's price.
    if (this.exchangeProducts.has(id) || this.exchangeLoading.has(id)) return;
    this.exchangeLoading = new Set(this.exchangeLoading).add(id);
    try {
      const cap = parseFloat(li.price) || 0;
      const products = await searchExchangeProducts(this.config, this.session, li.product_id, cap);
      this.exchangeProducts = new Map(this.exchangeProducts).set(id, products);
    } finally {
      const next = new Set(this.exchangeLoading);
      next.delete(id);
      this.exchangeLoading = next;
    }
  }

  private onExchangeProductChange(id: number, productId: number): void {
    const product = (this.exchangeProducts.get(id) ?? []).find(
      (p) => Number(p.id) === Number(productId),
    );
    const variant = product?.variants?.find((v) => v.available !== false) ?? product?.variants?.[0];
    this.updateSelection(id, {
      exchangeProductId: product ? Number(product.id) : undefined,
      exchangeVariantId: variant ? Number(variant.id) : undefined,
      exchangeLabel: product?.title,
    });
  }

  private onExchangeVariantChange(id: number, variantId: number): void {
    this.updateSelection(id, { exchangeVariantId: Number(variantId) });
  }

  private async handleSubmit(): Promise<void> {
    const items = [...this.selections.entries()].map(([id, sel]) => ({
      id,
      quantity: sel.lineItem?.quantity ?? 1,
      reasonId: sel.reasonId ?? '',
      reasonText: sel.reasonText ?? 'Other',
      comment: sel.comment ?? '',
      type: (sel.type ?? 'return') as 'return' | 'exchange',
      refundMode: sel.refundMode ?? 'store_credit',
      originalProductId: sel.lineItem?.product_id,
      originalVariantId: sel.lineItem?.variant_id,
      exchangeProductId: sel.exchangeProductId,
      exchangeVariantId: sel.exchangeVariantId,
    }));

    if (items.some((i) => !i.reasonId)) {
      this.error = 'Please select a reason for each item.';
      return;
    }
    if (
      items.some((i) => i.type === 'exchange' && (!i.exchangeProductId || !i.exchangeVariantId))
    ) {
      this.error = 'Please choose a product to exchange for.';
      return;
    }

    this.screen = 'submitting';
    this.error = '';

    try {
      const { serialNumber } = await createRequest(
        this.config,
        this.session,
        this.order!.id,
        items,
      );
      this.serialNumber = serialNumber;
      this.screen = 'success';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      this.screen = 'reasons';
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private renderLookup() {
    return html`
      <div class="rp-card">
        <p class="rp-title">Return or Exchange</p>
        <p class="rp-subtitle">Enter your order details to get started.</p>

        <form @submit=${this.handleLookup}>
          <div class="rp-field">
            <label class="rp-label" for="rp-order">Order Number</label>
            <input
              id="rp-order"
              class="rp-input"
              type="text"
              placeholder="e.g. 2457"
              .value=${this.orderInput}
              @input=${(e: InputEvent) => {
                this.orderInput = (e.target as HTMLInputElement).value;
              }}
              required
            />
          </div>
          <div class="rp-field">
            <label class="rp-label" for="rp-email">Email or Phone</label>
            <input
              id="rp-email"
              class="rp-input"
              type="text"
              placeholder="you@example.com"
              .value=${this.identifierInput}
              @input=${(e: InputEvent) => {
                this.identifierInput = (e.target as HTMLInputElement).value;
              }}
              required
            />
          </div>

          ${this.error ? html`<p class="rp-error-msg">${this.error}</p>` : nothing}

          <button class="rp-btn rp-btn-primary" type="submit">
            Find My Order
          </button>
        </form>
      </div>
    `;
  }

  private renderLoading() {
    return html`
      <div class="rp-card">
        <div class="rp-center">
          <div class="rp-spinner"></div>
          <span>Please wait…</span>
        </div>
      </div>
    `;
  }

  private renderItems() {
    const order = this.order!;
    return html`
      <div class="rp-card">
        <button class="rp-back" @click=${() => {
          this.screen = 'lookup';
          this.error = '';
        }}>
          ← Back
        </button>
        <p class="rp-title">Select Items to Return</p>
        <p class="rp-subtitle">Order ${order.name}</p>

        <div>
          ${this.lineItems.map(
            (li) => html`
              <div class="rp-item-row">
                <input
                  class="rp-item-check"
                  type="checkbox"
                  id="li-${li.id}"
                  .checked=${this.checkedIds.has(li.id)}
                  @change=${() => this.toggleItem(li.id)}
                />
                <label for="li-${li.id}" style="flex:1;cursor:pointer">
                  <div class="rp-item-info">
                    <p class="rp-item-title">${li.title}</p>
                    <p class="rp-item-meta">
                      Qty: ${li.quantity}
                      ${li.variant_title ? ` · ${li.variant_title}` : nothing}
                    </p>
                  </div>
                </label>
                <span class="rp-item-price">${this.fmt(li.price)}</span>
              </div>
            `,
          )}
        </div>

        <hr class="rp-divider" />
        <button
          class="rp-btn rp-btn-primary"
          ?disabled=${this.checkedIds.size === 0}
          @click=${this.handleItemsContinue}
        >
          Continue (${this.checkedIds.size} item${this.checkedIds.size === 1 ? '' : 's'})
        </button>
      </div>
    `;
  }

  private renderReasonForItem(id: number) {
    const sel = this.selections.get(id)!;
    const li = sel.lineItem!;

    const allRefundModes: Array<[string, string]> = [
      ['store_credit', 'Store Credit'],
      ['pay_to_source', 'Original Payment Method'],
      ['bank_transfer', 'Bank Transfer'],
    ];
    // Show only the refund modes the selected reason enables. This is how OS stores
    // hide Store Credit: the backend disables refund_mode.prepaid.store_credit for OS
    // reasons (OS can't process discount-code/gift-card refunds). Fall back to all
    // modes only if the reason specifies none.
    const prepaid = this.reasons.find((r) => String(r._id) === String(sel.reasonId))?.refund_mode
      ?.prepaid as Record<string, boolean> | undefined;
    const availableRefundModes =
      prepaid && (prepaid.store_credit || prepaid.pay_to_source || prepaid.bank_transfer)
        ? allRefundModes.filter(([value]) => prepaid[value])
        : allRefundModes;

    return html`
      <div class="rp-reason-block">
        <p class="rp-reason-block-title">${li.title}</p>

        ${
          this.reasons.length > 0
            ? html`
              <div class="rp-field">
                <label class="rp-label">Reason for return</label>
                <select
                  class="rp-select"
                  .value=${sel.reasonId ?? ''}
                  @change=${(e: Event) =>
                    this.onReasonChange(id, (e.target as HTMLSelectElement).value)}
                >
                  ${this.reasons.map((r) => html`<option value=${r._id}>${r.reason}</option>`)}
                </select>
              </div>
            `
            : html`
              <div class="rp-field">
                <label class="rp-label">Describe the issue</label>
                <textarea
                  class="rp-textarea"
                  placeholder="Tell us what went wrong…"
                  .value=${sel.comment ?? ''}
                  @input=${(e: InputEvent) =>
                    this.updateSelection(id, {
                      comment: (e.target as HTMLTextAreaElement).value,
                      reasonText: (e.target as HTMLTextAreaElement).value || 'Other',
                    })}
                ></textarea>
              </div>
            `
        }

        ${
          li.exchangeable
            ? html`
              <div class="rp-refund-section">
                <p class="rp-refund-label">How would you like to resolve this?</p>
                <div class="rp-radio-group">
                  <label class="rp-radio-label">
                    <input type="radio" name="type-${id}"
                      .checked=${(sel.type ?? 'return') === 'return'}
                      @change=${() => this.onTypeChange(id, 'return')} />
                    Return (refund)
                  </label>
                  <label class="rp-radio-label">
                    <input type="radio" name="type-${id}"
                      .checked=${sel.type === 'exchange'}
                      @change=${() => this.onTypeChange(id, 'exchange')} />
                    Exchange for another product
                  </label>
                </div>
              </div>
            `
            : nothing
        }

        ${
          sel.type === 'exchange'
            ? this.renderExchangePicker(id)
            : html`
              <div class="rp-refund-section">
                <p class="rp-refund-label">Refund to</p>
                <div class="rp-radio-group">
                  ${availableRefundModes.map(
                    ([value, label]) => html`
                      <label class="rp-radio-label">
                        <input
                          type="radio"
                          name="refund-${id}"
                          value=${value}
                          .checked=${sel.refundMode === value}
                          @change=${() => this.onRefundChange(id, value)}
                        />
                        ${label}
                      </label>
                    `,
                  )}
                </div>
              </div>
            `
        }
      </div>
    `;
  }

  private renderExchangePicker(id: number) {
    const sel = this.selections.get(id)!;
    if (this.exchangeLoading.has(id)) {
      return html`<div class="rp-refund-section"><p class="rp-refund-label">Loading products…</p></div>`;
    }
    const products = this.exchangeProducts.get(id) ?? [];
    if (products.length === 0) {
      return html`<div class="rp-refund-section"><p class="rp-refund-label">No products available to exchange for.</p></div>`;
    }
    const selectedProduct = products.find((p) => Number(p.id) === Number(sel.exchangeProductId));
    const variants = selectedProduct?.variants ?? [];
    return html`
      <div class="rp-plp">
        <label class="rp-label">Exchange for</label>
        <div class="rp-plp-grid" role="listbox" aria-label="Exchange products">
          ${products.map((p) => {
            const isSelected = Number(p.id) === Number(sel.exchangeProductId);
            return html`
              <button
                type="button"
                role="option"
                aria-selected=${isSelected}
                class="rp-plp-card${isSelected ? ' selected' : ''}"
                @click=${() => this.onExchangeProductChange(id, Number(p.id))}
              >
                <div class="rp-plp-check">
                  ${
                    p.image
                      ? html`<img class="rp-plp-thumb" src=${p.image} alt=${p.title} loading="lazy" />`
                      : html`<div class="rp-plp-thumb rp-plp-thumb--empty">🛍️</div>`
                  }
                  ${isSelected ? html`<span class="rp-plp-badge">✓</span>` : nothing}
                </div>
                <div class="rp-plp-body">
                  <div class="rp-plp-title">${p.title}</div>
                  <div class="rp-plp-price">${this.fmt(p.variants?.[0]?.price ?? 0)}</div>
                </div>
              </button>
            `;
          })}
        </div>
      </div>
      ${
        selectedProduct && variants.length > 1
          ? html`
            <div class="rp-variant-row">
              <label class="rp-label">Choose a variant</label>
              <div class="rp-variant-chips">
                ${variants.map((v) => {
                  const isSel = Number(v.id) === Number(sel.exchangeVariantId);
                  const unavailable = v.available === false;
                  return html`
                    <button
                      type="button"
                      class="rp-chip${isSel ? ' selected' : ''}"
                      ?disabled=${unavailable}
                      @click=${() => this.onExchangeVariantChange(id, Number(v.id))}
                    >
                      ${v.title} — ${this.fmt(v.price)}
                    </button>
                  `;
                })}
              </div>
            </div>
          `
          : nothing
      }
    `;
  }

  private renderReasons() {
    const ids = [...this.selections.keys()];
    return html`
      <div class="rp-card">
        <button class="rp-back" @click=${() => {
          this.screen = 'items';
          this.error = '';
        }}>
          ← Back
        </button>
        <p class="rp-title">Return Details</p>
        <p class="rp-subtitle">Tell us why you're returning these items.</p>

        ${ids.map((id) => this.renderReasonForItem(id))}

        ${this.error ? html`<p class="rp-error-msg">${this.error}</p>` : nothing}

        <button class="rp-btn rp-btn-primary" @click=${this.handleSubmit}>
          Submit Return Request
        </button>
      </div>
    `;
  }

  private renderSubmitting() {
    return html`
      <div class="rp-card">
        <div class="rp-center">
          <div class="rp-spinner"></div>
          <span>Submitting your return…</span>
        </div>
      </div>
    `;
  }

  private renderSuccess() {
    return html`
      <div class="rp-card" style="text-align:center">
        <div class="rp-center">
          <div class="rp-success-icon">✓</div>
          <p class="rp-title">Return Submitted!</p>
          <p class="rp-serial">${this.serialNumber}</p>
          <p class="rp-subtitle" style="margin:0">
            We've received your request. You'll get an email with next steps.
          </p>
        </div>
        <button
          class="rp-btn rp-btn-primary"
          style="margin-top:8px"
          @click=${() => {
            this.screen = 'lookup';
            this.orderInput = '';
            this.identifierInput = '';
          }}
        >
          Start a New Return
        </button>
      </div>
    `;
  }

  override render() {
    const style = this.primaryColor
      ? html`<style>:host { --rp-primary: ${this.primaryColor}; --rp-primary-hover: ${this.primaryColor}; }</style>`
      : nothing;

    let content: TemplateResult;
    switch (this.screen) {
      case 'lookup':
        content = this.renderLookup();
        break;
      case 'loading':
        content = this.renderLoading();
        break;
      case 'items':
        content = this.renderItems();
        break;
      case 'reasons':
        content = this.renderReasons();
        break;
      case 'submitting':
        content = this.renderSubmitting();
        break;
      case 'success':
        content = this.renderSuccess();
        break;
      default:
        content = this.renderLookup();
    }

    return html`${style}${content}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rp-return-portal': RpReturnPortal;
  }
}
