import type { FormField } from '@shared/schemas/form-schema';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@/lib/builder-state';
import { renderWithProviders } from '../test-utils';
import { FormPreview } from './FormPreview';

const fields: FormField[] = [
  { key: 'name', label: 'Name', required: true, type: 'text', width: 'full', showCounter: false },
];

/** The single `<ratio-form>` the preview mounts; its shadow root is the SDK render. */
function previewEl(): HTMLElement & { shadowRoot: ShadowRoot } {
  const el = document.querySelector('ratio-form');
  if (!el?.shadowRoot) throw new Error('ratio-form not mounted');
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

function shadow() {
  return previewEl().shadowRoot;
}

/** Click a state option by its label (drives the antd Segmented radio input). */
function selectState(label: string) {
  const input = screen.getByText(label).closest('label')?.querySelector('input');
  if (!input) throw new Error(`no state option: ${label}`);
  fireEvent.click(input);
}

afterEach(() => {
  // Injected font <link>s live at document scope; clear them between tests.
  for (const link of document.querySelectorAll('link[id^="ratio-font-"]')) link.remove();
});

describe('FormPreview', () => {
  it('renders the current schema through the real storefront element', async () => {
    renderWithProviders(<FormPreview name="Waitlist" fields={fields} mode="desktop" />);
    await waitFor(() => expect(shadow().querySelector('.rf-card')).toBeTruthy());
    // The title and field label come from the SDK renderer, not a duplicate.
    expect(shadow().querySelector('.rf-title')?.textContent).toContain('Waitlist');
    expect(shadow().textContent).toContain('Name');
    // The submit button is the SDK's, so no hand-rolled markup remains.
    expect(shadow().querySelector('.rf-submit')).toBeTruthy();
  });

  it('drives the SDK theme tokens from the appearance', async () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      colors: { ...DEFAULT_APPEARANCE.colors, primary: '#ff0000' },
    };
    renderWithProviders(
      <FormPreview name="Waitlist" fields={fields} appearance={appearance} mode="desktop" />,
    );
    await waitFor(() => expect(shadow().querySelector('.rf-card')).toBeTruthy());
    // themeVars() is the single source of truth: the primary reaches the shadow
    // style block verbatim (this is exactly what the storefront embed emits).
    const styleText = Array.from(shadow().querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('');
    expect(styleText).toContain('#ff0000');
  });

  it('previews the success ending screen when the state control is switched', async () => {
    renderWithProviders(<FormPreview name="Waitlist" fields={fields} mode="desktop" />);
    await waitFor(() => expect(shadow().querySelector('.rf-submit')).toBeTruthy());
    selectState('Success');
    await waitFor(() => expect(shadow().querySelector('[data-state="success"]')).toBeTruthy());
    // The fillable form is gone once the ending screen is shown.
    expect(shadow().querySelector('.rf-submit')).toBeFalsy();
  });

  it('forwards the configured submit label to the SDK preview', async () => {
    renderWithProviders(
      <FormPreview name="Waitlist" fields={fields} submitLabel="Join now" mode="desktop" />,
    );
    await waitFor(() => expect(shadow().querySelector('.rf-submit')).toBeTruthy());
    expect(shadow().querySelector('.rf-submit')?.textContent).toContain('Join now');
  });

  it('forwards the configured success message to the ending screen', async () => {
    renderWithProviders(
      <FormPreview
        name="Waitlist"
        fields={fields}
        successMessage="You are on the list!"
        mode="desktop"
      />,
    );
    await waitFor(() => expect(shadow().querySelector('.rf-submit')).toBeTruthy());
    selectState('Success');
    await waitFor(() => expect(shadow().querySelector('[data-state="success"]')).toBeTruthy());
    expect(shadow().querySelector('[data-state="success"]')?.textContent).toContain(
      'You are on the list!',
    );
  });

  it('previews the closed screen when the state control is switched', async () => {
    renderWithProviders(<FormPreview name="Waitlist" fields={fields} mode="desktop" />);
    await waitFor(() => expect(shadow().querySelector('.rf-submit')).toBeTruthy());
    selectState('Closed');
    await waitFor(() => expect(shadow().querySelector('[data-state="closed"]')).toBeTruthy());
  });

  it('injects the Google Font link at document scope for a non-system family', async () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      typography: { ...DEFAULT_APPEARANCE.typography, fontFamily: 'inter' as const },
    };
    renderWithProviders(
      <FormPreview name="Waitlist" fields={fields} appearance={appearance} mode="desktop" />,
    );
    // The SDK owns font loading, so the preview gets the correct webfont too.
    await waitFor(() => expect(document.getElementById('ratio-font-inter')).toBeTruthy());
  });

  it('frames the mobile preview at 375px', async () => {
    renderWithProviders(<FormPreview name="X" fields={fields} mode="mobile" />);
    expect(screen.getByTestId('preview-mobile')).toHaveStyle({ width: '375px' });
  });
});
