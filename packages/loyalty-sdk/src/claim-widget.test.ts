import type { LoyaltyClaimResponse, LoyaltyQrStatus } from '@ratio-app/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoyaltyClient } from './client';
import './claim-widget';
import type { LoyaltyClaimWidget } from './claim-widget';
import { KWIKPASS_TOKEN_KEYS } from './kwikpass';

const CODE = 'ABCD1234EFGH5678';

const activeStatus: LoyaltyQrStatus = {
  state: 'active',
  eventName: 'Launch Party',
  points: 50,
  programName: 'Wellversed Coins',
};

function stubClient(
  status: LoyaltyQrStatus | Error = activeStatus,
  claim: LoyaltyClaimResponse | Error = {
    status: 'credited',
    points: 50,
    newBalance: 150,
    programName: 'Wellversed Coins',
  },
) {
  return {
    qrStatus: vi.fn(async () => {
      if (status instanceof Error) throw status;
      return status;
    }),
    claim: vi.fn(async () => {
      if (claim instanceof Error) throw claim;
      return claim;
    }),
  };
}

async function mount(client: ReturnType<typeof stubClient>): Promise<LoyaltyClaimWidget> {
  const el = document.createElement('loyalty-claim-widget');
  el.code = CODE;
  el.client = client as unknown as LoyaltyClient;
  document.body.appendChild(el);
  await el.updateComplete;
  // let the qrStatus() microtasks settle, then re-render
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

function shadowText(el: LoyaltyClaimWidget): string {
  return el.shadowRoot?.textContent ?? '';
}

function setToken(token: string): void {
  window.localStorage.setItem('KWIKUSERTOKEN', token);
}

function clearStorage(): void {
  window.localStorage.clear();
  for (const key of KWIKPASS_TOKEN_KEYS) {
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

describe('<loyalty-claim-widget>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearStorage();
  });
  afterEach(() => {
    clearStorage();
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup of the host-provided global
    window.handleCustomLogin = undefined;
  });

  describe('status rendering', () => {
    it('renders the active state: event name, points, program name, CTA', async () => {
      const el = await mount(stubClient());
      const text = shadowText(el);
      expect(text).toContain('Launch Party');
      expect(text).toContain('Earn 50 Wellversed Coins');
      expect(el.shadowRoot?.querySelector('button.cta')).not.toBeNull();
    });

    it.each([
      ['not_started', 'not started'],
      ['expired', 'ended'],
      ['paused', 'paused'],
      ['fully_claimed', 'claimed'],
    ] as const)('renders the %s terminal state without a CTA', async (state, phrase) => {
      const el = await mount(stubClient({ ...activeStatus, state }));
      expect(shadowText(el).toLowerCase()).toContain(phrase);
      expect(el.shadowRoot?.querySelector('button.cta')).toBeNull();
    });

    it('shows the claimMessage when present', async () => {
      const el = await mount(stubClient({ ...activeStatus, claimMessage: 'See you there!' }));
      expect(shadowText(el)).toContain('See you there!');
    });

    it('renders an error and dispatches loyalty:claim:error when status fails', async () => {
      const onError = vi.fn();
      window.addEventListener('loyalty:claim:error', onError);
      const el = await mount(stubClient(new Error('network down')));
      expect(shadowText(el).toLowerCase()).toContain('could not load');
      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        code: CODE,
        reason: 'status_failed',
      });
      window.removeEventListener('loyalty:claim:error', onError);
    });
  });

  describe('claim flow', () => {
    it('with a stored token: claims, renders credited, dispatches loyalty:claim:success', async () => {
      setToken('gk-token');
      const onSuccess = vi.fn();
      window.addEventListener('loyalty:claim:success', onSuccess);
      const client = stubClient();
      const el = await mount(client);

      await el.onClaimClick();
      await el.updateComplete;

      expect(client.claim).toHaveBeenCalledWith(CODE, 'gk-token');
      const text = shadowText(el);
      expect(text).toContain('Congratulations');
      expect(text).toContain('50 Wellversed Coins added');
      expect(text).toContain('New balance: 150');
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect((onSuccess.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        code: CODE,
        points: 50,
        newBalance: 150,
        programName: 'Wellversed Coins',
      });
      window.removeEventListener('loyalty:claim:success', onSuccess);
    });

    it('without a token: requests login, then claims after user-loggedin', async () => {
      const onLoginRequest = vi.fn();
      window.addEventListener('loyalty:login:request', onLoginRequest);
      const handleCustomLogin = vi.fn();
      window.handleCustomLogin = handleCustomLogin;
      const client = stubClient();
      const el = await mount(client);

      await el.onClaimClick();
      await el.updateComplete;

      expect(onLoginRequest).toHaveBeenCalledTimes(1);
      expect(handleCustomLogin).toHaveBeenCalledWith(false);
      expect(client.claim).not.toHaveBeenCalled();
      expect(shadowText(el).toLowerCase()).toContain('log in');

      // user completes KwikPass OTP → SDK stores the token → fires the event
      setToken('fresh-token');
      window.dispatchEvent(new CustomEvent('user-loggedin'));
      await el.updateComplete;
      await Promise.resolve();
      await el.updateComplete;

      expect(client.claim).toHaveBeenCalledWith(CODE, 'fresh-token');
      expect(shadowText(el)).toContain('Congratulations');
      window.removeEventListener('loyalty:login:request', onLoginRequest);
    });

    it('renders already_claimed with the balance and no error event', async () => {
      setToken('gk-token');
      const onError = vi.fn();
      window.addEventListener('loyalty:claim:error', onError);
      const el = await mount(
        stubClient(activeStatus, {
          status: 'already_claimed',
          balance: 120,
          programName: 'Wellversed Coins',
        }),
      );

      await el.onClaimClick();
      await el.updateComplete;

      const text = shadowText(el);
      expect(text.toLowerCase()).toContain('already claimed');
      expect(text).toContain('120 Wellversed Coins');
      expect(onError).not.toHaveBeenCalled();
      window.removeEventListener('loyalty:claim:error', onError);
    });

    it('invalid_session re-prompts KwikPass login exactly once, then renders terminal', async () => {
      setToken('stale-token');
      const onLoginRequest = vi.fn();
      window.addEventListener('loyalty:login:request', onLoginRequest);
      const client = stubClient(activeStatus, { status: 'invalid_session' });
      const el = await mount(client);

      // 1st invalid_session → drop the stale token and re-prompt login once
      await el.onClaimClick();
      await el.updateComplete;
      expect(onLoginRequest).toHaveBeenCalledTimes(1);
      expect(shadowText(el).toLowerCase()).toContain('log in');
      // the dead token was cleared so the resume path can't read it back
      expect(window.localStorage.getItem('KWIKUSERTOKEN')).toBeNull();

      // fresh login → resume with the new token, still invalid_session → terminal
      setToken('fresh-token');
      window.dispatchEvent(new CustomEvent('user-loggedin'));
      await el.updateComplete;
      await Promise.resolve();
      await el.updateComplete;

      expect(client.claim).toHaveBeenCalledTimes(2);
      expect(client.claim).toHaveBeenLastCalledWith(CODE, 'fresh-token');
      expect(onLoginRequest).toHaveBeenCalledTimes(1); // NOT auto-re-prompted again
      const text = shadowText(el).toLowerCase();
      expect(text).toContain('session has expired');
      // terminal invalid_session offers a manual "log in & claim" retry button
      expect(el.shadowRoot?.querySelector('button.cta')).not.toBeNull();
      window.removeEventListener('loyalty:login:request', onLoginRequest);
    });

    it('the terminal invalid_session retry button re-prompts login again', async () => {
      setToken('stale-token');
      const onLoginRequest = vi.fn();
      window.addEventListener('loyalty:login:request', onLoginRequest);
      const el = await mount(stubClient(activeStatus, { status: 'invalid_session' }));

      // auto re-prompt (1), fresh login, still invalid → terminal with button
      await el.onClaimClick();
      await el.updateComplete;
      setToken('fresh-token');
      window.dispatchEvent(new CustomEvent('user-loggedin'));
      await el.updateComplete;
      await Promise.resolve();
      await el.updateComplete;

      // user taps the manual retry → login is re-prompted (2)
      const retry = el.shadowRoot?.querySelector('button.cta') as HTMLButtonElement;
      retry.click();
      await el.updateComplete;
      expect(onLoginRequest).toHaveBeenCalledTimes(2);
      expect(shadowText(el).toLowerCase()).toContain('log in');
      window.removeEventListener('loyalty:login:request', onLoginRequest);
    });

    it('invalid_signature renders a terminal error immediately (no login re-prompt)', async () => {
      setToken('gk-token');
      const onLoginRequest = vi.fn();
      const onError = vi.fn();
      window.addEventListener('loyalty:login:request', onLoginRequest);
      window.addEventListener('loyalty:claim:error', onError);
      const client = stubClient(activeStatus, { status: 'invalid_signature' });
      const el = await mount(client);

      await el.onClaimClick();
      await el.updateComplete;

      expect(client.claim).toHaveBeenCalledTimes(1); // no retry
      expect(onLoginRequest).not.toHaveBeenCalled(); // config error, not a session issue
      expect(shadowText(el).toLowerCase()).toContain("couldn't verify this reward");
      expect((onError.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        code: CODE,
        reason: 'invalid_signature',
      });
      window.removeEventListener('loyalty:login:request', onLoginRequest);
      window.removeEventListener('loyalty:claim:error', onError);
    });

    it('renders the terminal message for an unavailable claim', async () => {
      setToken('gk-token');
      const el = await mount(stubClient(activeStatus, { status: 'unavailable', state: 'expired' }));

      await el.onClaimClick();
      await el.updateComplete;

      expect(shadowText(el).toLowerCase()).toContain('ended');
    });

    it('dispatches loyalty:claim:error when the claim request fails', async () => {
      setToken('gk-token');
      const onError = vi.fn();
      window.addEventListener('loyalty:claim:error', onError);
      const el = await mount(stubClient(activeStatus, new Error('boom')));

      await el.onClaimClick();
      await el.updateComplete;

      expect(shadowText(el).toLowerCase()).toContain('something went wrong');
      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        code: CODE,
        reason: 'network_error',
      });
      window.removeEventListener('loyalty:claim:error', onError);
    });
  });

  it('close button removes the widget from the DOM', async () => {
    const el = await mount(stubClient());
    const close = el.shadowRoot?.querySelector('button.close') as HTMLButtonElement;
    close.click();
    expect(document.querySelector('loyalty-claim-widget')).toBeNull();
  });
});
