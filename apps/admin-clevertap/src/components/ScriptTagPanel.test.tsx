import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils';
import {
  clevertapApiBase,
  PIXEL_CONFIG_LINE,
  ScriptTagPanel,
  scriptTagFor,
} from './ScriptTagPanel';

const MERCHANT_ID = 'merchant-123';

function expectedSnippet(): string {
  return `<Script src="${clevertapApiBase()}/sdk/${MERCHANT_ID}.js" strategy="afterInteractive" />`;
}

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ScriptTagPanel', () => {
  it('shows the next/script snippet for the current merchant', () => {
    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    expect(screen.getByText(expectedSnippet())).toBeInTheDocument();
  });

  it('builds the URL under the /clevertap namespace as a next/script tag', () => {
    const snippet = scriptTagFor(MERCHANT_ID);
    expect(snippet).toContain(`/clevertap/sdk/${MERCHANT_ID}.js`);
    expect(snippet).toContain('strategy="afterInteractive"');
  });

  it('does NOT use the superseded raw <script defer> / paste-into-head form', () => {
    const snippet = scriptTagFor(MERCHANT_ID);
    expect(snippet).not.toContain('<script ');
    expect(snippet).not.toContain('defer');
    expect(snippet).not.toContain('</script>');

    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    expect(screen.queryByText(/Paste into/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/<head>/)).not.toBeInTheDocument();
  });

  it('shows step 2 pointing at src/config/pixelConfig.ts, not the stale lib path', () => {
    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    expect(screen.getByText('src/config/pixelConfig.ts')).toBeInTheDocument();
    expect(screen.queryByText(/lib\/pixelConfig\.ts/)).not.toBeInTheDocument();
  });

  it('activates the pixel under the clevertap-ratio key', () => {
    expect(PIXEL_CONFIG_LINE).toBe('"clevertap-ratio": {},');
    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    expect(screen.getByText(PIXEL_CONFIG_LINE)).toBeInTheDocument();
  });

  it('copies the script tag exactly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy script tag/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedSnippet()));
    expect(await screen.findByText(/Copied to clipboard/)).toBeInTheDocument();
  });

  it('copies the pixelConfig line exactly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy config line/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PIXEL_CONFIG_LINE));
  });

  it('tells the merchant to copy manually when clipboard access is denied', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));

    renderWithProviders(<ScriptTagPanel merchantId={MERCHANT_ID} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy script tag/ }));

    expect(await screen.findByText(/copy it manually/)).toBeInTheDocument();
  });
});
