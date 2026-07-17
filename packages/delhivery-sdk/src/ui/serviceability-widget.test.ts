import { beforeEach, describe, expect, it, vi } from 'vitest';
import './serviceability-widget';
import type { DelhiveryServiceability } from '../client';
import type { DelhiveryServiceabilityWidget } from './serviceability-widget';

const SERVICEABLE: DelhiveryServiceability = {
  serviceable: true,
  cod_available: true,
  edd_min: 2,
  edd_max: 5,
  edd_estimated: true,
  carrier: 'DELHIVERY',
};

function stubClient(result: DelhiveryServiceability | Error) {
  return {
    checkServiceability: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

async function mount(client: ReturnType<typeof stubClient>, pincode = '110001') {
  const el = document.createElement('delhivery-serviceability') as DelhiveryServiceabilityWidget;
  el.setAttribute('merchant-id', 'mer_1');
  el.setAttribute('api-base', 'https://apps.ratio.example');
  el.client = client;
  el.pincode = pincode;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('<delhivery-serviceability>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.__DELHIVERY__;
  });

  it('widget.rendersInput — shows a pincode input and a check button', async () => {
    const el = await mount(stubClient(SERVICEABLE), '');
    const input = el.shadowRoot?.querySelector('input');
    const button = el.shadowRoot?.querySelector('button');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('inputmode')).toBe('numeric');
    expect(button).not.toBeNull();
    el.remove();
  });

  it('widget.rendersResult — serviceable PIN shows the EDD band and a COD badge', async () => {
    const client = stubClient(SERVICEABLE);
    const el = await mount(client);
    await el.check();
    await el.updateComplete;
    expect(client.checkServiceability).toHaveBeenCalledWith('110001');
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Delivery available');
    expect(text).toContain('2–5 days');
    expect(text).toContain('COD available');
    el.remove();
  });

  it('widget.prepaidOnlyBadge — cod_available:false renders Prepaid only', async () => {
    const el = await mount(stubClient({ ...SERVICEABLE, cod_available: false }));
    await el.check();
    await el.updateComplete;
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Prepaid only');
    expect(text).not.toContain('COD available');
    el.remove();
  });

  it('widget.rendersNotServiceable — unserviceable PIN shows the unavailable message', async () => {
    const el = await mount(
      stubClient({ ...SERVICEABLE, serviceable: false, cod_available: false }),
    );
    await el.check();
    await el.updateComplete;
    const text = el.shadowRoot?.textContent ?? '';
    expect(text.toLowerCase()).toContain('not available');
    el.remove();
  });

  it('widget.emitsServiceabilityEvent — a composed CustomEvent carries the verdict', async () => {
    const el = await mount(stubClient(SERVICEABLE));
    const onEvent = vi.fn();
    // Listen on document — the event must bubble + compose out of the shadow root.
    document.addEventListener('serviceability', (e) => onEvent((e as CustomEvent).detail), {
      once: true,
    });
    await el.check();
    expect(onEvent).toHaveBeenCalledWith({ pincode: '110001', result: SERVICEABLE });
    el.remove();
  });

  it('widget.invalidPinError — a bad PIN shows a validation message and never calls the client', async () => {
    const client = stubClient(SERVICEABLE);
    const el = await mount(client, '12ab');
    await el.check();
    await el.updateComplete;
    expect(client.checkServiceability).not.toHaveBeenCalled();
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('6-digit');
    el.remove();
  });

  it('widget.failureIsSoft — a network/API failure shows a retry message, not a crash', async () => {
    const el = await mount(stubClient(new Error('boom')));
    await el.check();
    await el.updateComplete;
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Could not check');
    el.remove();
  });

  it('widget.enterKeySubmits — pressing Enter in the input triggers a check', async () => {
    const client = stubClient(SERVICEABLE);
    const el = await mount(client);
    const input = el.shadowRoot?.querySelector('input') as HTMLInputElement;
    input.value = '560001';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    expect(client.checkServiceability).toHaveBeenCalledWith('560001');
    el.remove();
  });
});
