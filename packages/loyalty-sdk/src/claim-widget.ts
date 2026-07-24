// `<loyalty-claim-widget>` — the QR claim UI. Mobile-first modal/card in
// Shadow DOM. Lifecycle: fetch QR status → render (active CTA or terminal
// state) → claim with the KwikPass token (requesting login when absent) →
// render the claim outcome. All styles are inline Lit `css` — no external CSS.

import type { LoyaltyClaimResponse, LoyaltyQrState, LoyaltyQrStatus } from '@ratio-app/shared';
import { css, html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { LoyaltyClient, LoyaltyClientError } from './client';
import { clearKwikPassToken, getKwikPassToken, onLoggedIn, requestLogin } from './kwikpass';

/** Window event dispatched after a successful credit. */
export const CLAIM_SUCCESS_EVENT = 'loyalty:claim:success';
/** Window event dispatched on any claim failure (with a `reason` detail). */
export const CLAIM_ERROR_EVENT = 'loyalty:claim:error';

/** Copy for the terminal (non-claimable) QR states. */
const STATE_MESSAGES: Record<Exclude<LoyaltyQrState, 'active'>, string> = {
  not_started: 'This campaign has not started yet. Come back soon!',
  expired: 'This campaign has ended.',
  paused: 'This campaign is paused right now. Please try again later.',
  fully_claimed: 'All rewards for this campaign have been claimed.',
};

type Phase = 'loading' | 'status' | 'waiting_login' | 'claiming' | 'result' | 'error';

@customElement('loyalty-claim-widget')
export class LoyaltyClaimWidget extends LitElement {
  /** QR code being claimed (from `?loyalty_qr=`). */
  @property({ type: String }) code = '';
  /**
   * Same-origin storefront base used to build a client when none is
   * injected. Defaults to `window.location.origin` — the widget always
   * talks to the merchant storefront's own BFF, never a cross-origin
   * backend, so this rarely needs setting explicitly.
   */
  @property({ attribute: 'base-url' }) baseUrl = '';
  /** Overlay/modal mode (set by the loader when mounted with no container). */
  @property({ type: Boolean, reflect: true }) overlay = false;
  /** Injectable API client (tests / programmatic use). */
  @property({ attribute: false }) client?: LoyaltyClient;

  @state() private phase: Phase = 'loading';
  @state() private status?: LoyaltyQrStatus;
  @state() private result?: LoyaltyClaimResponse;
  @state() private errorMessage = '';

  /** Only auto-re-prompt KwikPass login ONCE after an `invalid_session` claim. */
  private retriedLogin = false;
  private loginUnsub: (() => void) | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.client) {
      this.client = new LoyaltyClient({ baseUrl: this.baseUrl || window.location.origin });
    }
  }

  override disconnectedCallback(): void {
    this.loginUnsub?.();
    this.loginUnsub = undefined;
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    void this.loadStatus();
  }

  /** Step 1: fetch the QR render data. */
  async loadStatus(): Promise<void> {
    if (!this.client || !this.code) {
      this.phase = 'error';
      this.errorMessage = 'This QR link is not valid.';
      return;
    }
    try {
      this.status = await this.client.qrStatus(this.code);
      this.phase = 'status';
    } catch (err) {
      this.phase = 'error';
      this.errorMessage =
        err instanceof LoyaltyClientError && err.status === 404
          ? 'This QR code was not found.'
          : 'Could not load this reward. Please try again.';
      this.emitError('status_failed');
    }
  }

  /** Claim CTA: use the stored KwikPass token, or request a login first. */
  async onClaimClick(): Promise<void> {
    const token = getKwikPassToken();
    if (!token) {
      this.startLogin();
      return;
    }
    await this.doClaim(token);
  }

  /** Open KwikPass login and resume the claim on `user-loggedin`. */
  private startLogin(): void {
    this.phase = 'waiting_login';
    this.loginUnsub?.();
    this.loginUnsub = onLoggedIn(() => {
      this.loginUnsub?.();
      this.loginUnsub = undefined;
      const token = getKwikPassToken();
      if (token) {
        void this.doClaim(token);
      } else {
        this.phase = 'status';
      }
    });
    requestLogin();
  }

  private async doClaim(token: string): Promise<void> {
    if (!this.client) return;
    this.phase = 'claiming';
    try {
      const res = await this.client.claim(this.code, token);
      if (res.status === 'invalid_session' && !this.retriedLogin) {
        // The shopper's KwikPass session is stale/expired — the BFF couldn't
        // resolve a verified phone. Drop the dead token and re-prompt login
        // once; the resume-on-`user-loggedin` path retries the claim with the
        // fresh token. (`invalid_signature`, by contrast, is a server/config
        // error and falls straight through to a terminal message below.)
        this.retriedLogin = true;
        this.emitError('invalid_session');
        clearKwikPassToken();
        this.startLogin();
        return;
      }
      this.result = res;
      this.phase = 'result';
      if (res.status === 'credited') {
        window.dispatchEvent(
          new CustomEvent(CLAIM_SUCCESS_EVENT, {
            detail: {
              code: this.code,
              points: res.points,
              newBalance: res.newBalance,
              programName: res.programName,
            },
          }),
        );
      } else if (res.status !== 'already_claimed') {
        this.emitError(res.status);
      }
    } catch (err) {
      this.phase = 'error';
      this.errorMessage = 'Something went wrong while claiming. Please try again.';
      this.emitError(err instanceof LoyaltyClientError ? `http_${err.status}` : 'network_error');
    }
  }

  /**
   * Manual "log in & claim" retry offered after a terminal `invalid_session`:
   * reset the one-shot guard, drop any dead token, and re-open KwikPass login.
   */
  private retryLogin(): void {
    this.retriedLogin = false;
    clearKwikPassToken();
    this.startLogin();
  }

  private emitError(reason: string): void {
    window.dispatchEvent(
      new CustomEvent(CLAIM_ERROR_EVENT, { detail: { code: this.code, reason } }),
    );
  }

  /** Close button: remove the widget (the loader's cleanup does the same). */
  close(): void {
    this.remove();
  }

  private renderBody(): TemplateResult {
    switch (this.phase) {
      case 'loading':
        return html`<p class="muted">Loading your reward…</p>`;
      case 'waiting_login':
        return html`<p class="muted">Log in with your phone number to claim.</p>
          <button class="cta" @click=${() => this.onClaimClick()}>Log in &amp; claim</button>`;
      case 'claiming':
        return html`<p class="muted">Claiming your reward…</p>`;
      case 'status':
        return this.renderStatus();
      case 'result':
        return this.renderResult();
      default:
        return html`<p class="error">${this.errorMessage}</p>`;
    }
  }

  private renderStatus(): TemplateResult {
    const s = this.status;
    if (!s) return html`<p class="error">This QR link is not valid.</p>`;
    // The claim message renders INLINE into a stable `<p class="note">` (a
    // direct text-part, like the `.points` line above — hidden via
    // `.note:empty` when blank), never as a nested-template or conditional
    // child-part: happy-dom's parser drops a `${html`…`}` element child-part
    // and can swallow a following attribute binding (@click) into text. A
    // plain inline text-part parses reliably in happy-dom and real browsers.
    if (s.state !== 'active') {
      return html`
        <h2>${s.eventName}</h2>
        <p class="muted">${STATE_MESSAGES[s.state]}</p>
        <p class="note">${s.claimMessage ?? ''}</p>
      `;
    }
    return html`
      <h2>${s.eventName}</h2>
      <p class="points">Earn ${s.points} ${s.programName}</p>
      <p class="note">${s.claimMessage ?? ''}</p>
      <button class="cta" @click=${() => this.onClaimClick()}>
        Claim ${s.points} ${s.programName}
      </button>
    `;
  }

  private renderResult(): TemplateResult {
    const r = this.result;
    if (!r) return html`<p class="error">Something went wrong.</p>`;
    switch (r.status) {
      case 'credited':
        return html`
          <h2>Congratulations!</h2>
          <p class="points">${r.points} ${r.programName} added</p>
          <p class="muted">New balance: ${r.newBalance} ${r.programName}</p>
        `;
      case 'already_claimed':
        return html`
          <h2>Already claimed</h2>
          <p class="muted">
            You have already claimed this reward. Your balance: ${r.balance} ${r.programName}
          </p>
        `;
      case 'unavailable':
        return html`<p class="muted">${STATE_MESSAGES[r.state === 'active' ? 'paused' : r.state]}</p>`;
      case 'invalid_session':
        // A fresh login still didn't yield a usable session — offer a manual
        // "log in & claim" retry rather than dead-ending.
        return html`
          <p class="error">Your login session has expired. Please log in to claim.</p>
          <button class="cta" @click=${() => this.retryLogin()}>Log in &amp; claim</button>
        `;
      default:
        // `invalid_signature` — a server/config error, not shopper-recoverable.
        return html`<p class="error">We couldn't verify this reward right now. Please try again later.</p>`;
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="card" role="dialog" aria-label="Loyalty reward">
        <button class="close" aria-label="Close" @click=${() => this.close()}>&times;</button>
        ${this.renderBody()}
      </div>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      font-family:
        system-ui,
        -apple-system,
        'Segoe UI',
        Roboto,
        sans-serif;
      color: #111;
      --loyalty-accent: #0f8a6d;
    }
    :host([overlay]) {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      padding: 16px;
    }
    @media (min-width: 480px) {
      :host([overlay]) {
        align-items: center;
      }
    }
    .card {
      position: relative;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
      padding: 24px 20px;
      width: 100%;
      max-width: 380px;
      text-align: center;
      box-sizing: border-box;
    }
    .close {
      position: absolute;
      top: 8px;
      right: 10px;
      border: 0;
      background: none;
      font-size: 22px;
      line-height: 1;
      color: #888;
      cursor: pointer;
      padding: 4px;
    }
    h2 {
      margin: 4px 0 8px;
      font-size: 20px;
    }
    .points {
      font-size: 17px;
      font-weight: 600;
      color: var(--loyalty-accent);
      margin: 8px 0;
    }
    .muted {
      color: #555;
      font-size: 14px;
      margin: 8px 0;
    }
    .note {
      color: #333;
      font-size: 13px;
      margin: 8px 0;
    }
    .note:empty {
      display: none;
    }
    .error {
      color: #b00020;
      font-size: 14px;
      margin: 8px 0;
    }
    .cta {
      display: inline-block;
      margin-top: 12px;
      width: 100%;
      border: 0;
      border-radius: 10px;
      background: var(--loyalty-accent);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      padding: 12px 16px;
      cursor: pointer;
    }
    .cta:active {
      opacity: 0.85;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'loyalty-claim-widget': LoyaltyClaimWidget;
  }
}
