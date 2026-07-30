import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '@/lib/builder-state';
import { FORM_APPEARANCE_PRESETS } from '@/lib/presets';
import { renderWithProviders } from '../test-utils';
import { DesignSettings } from './DesignSettings';

describe('DesignSettings', () => {
  it('renders a colour picker per token and the WCAG contrast report', () => {
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={vi.fn()} />);
    expect(screen.getByLabelText('Primary color')).toBeInTheDocument();
    expect(screen.getByLabelText('Button text color')).toBeInTheDocument();
    // The card colour and the surrounding page colour are separate pickers.
    expect(screen.getByLabelText('Form background color')).toBeInTheDocument();
    expect(screen.getByLabelText('Page background color')).toBeInTheDocument();
    // Text (#1a1a1a) on background (#ffffff) clears AA at the defaults.
    expect(screen.getByTestId('contrast-text-background')).toHaveTextContent('AA');
    // The page colour is included in the WCAG report too.
    expect(screen.getByTestId('contrast-text-pageBackground')).toHaveTextContent('AA');
  });

  it('sets the page background colour scoped to the colors group', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    expect(screen.getByLabelText('Page background color')).toBeInTheDocument();
  });

  it('dispatches a button alignment change scoped to the layout group', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const center = screen.getByText('Center');
    fireEvent.click(center.closest('label') ?? center);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { buttonAlign: 'center' } },
    });
  });

  it('dispatches a deep-partial updateAppearance from a layout toggle', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText('Full-width button'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { fullWidthButton: true } },
    });
  });

  it('dispatches a font-family change scoped to the typography group', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    // Design sections are an accordion; expand Typography before touching its Select.
    fireEvent.click(screen.getByText('Typography'));
    // antd Select renders the value; open it and pick another family.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Font family' }));
    fireEvent.click(screen.getByText('Inter'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { typography: { fontFamily: 'inter' } },
    });
  });

  it('dispatches a custom Google font change scoped to the typography group', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Typography'));
    const input = screen.getByLabelText('Custom Google font');
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Figtree' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { typography: { customGoogleFont: 'Figtree' } },
    });
  });

  it('clears the custom Google font to undefined on an empty input', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Typography'));
    const input = screen.getByLabelText('Custom Google font');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { typography: { customGoogleFont: undefined } },
    });
  });

  it('renders a mini form thumbnail per preset', () => {
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Presets'));
    for (const preset of FORM_APPEARANCE_PRESETS) {
      expect(screen.getByTestId(`preset-thumb-${preset.id}`)).toBeInTheDocument();
    }
  });

  it('applies a preset wholesale (colors + typography + layout + background), leaving assets alone', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const teal = FORM_APPEARANCE_PRESETS.find((p) => p.id === 'teal');
    if (!teal) throw new Error('teal preset missing');
    fireEvent.click(screen.getByText('Presets'));
    fireEvent.click(screen.getByLabelText('Apply Teal preset'));
    // Wholesale replace of the style sections (so an optional token the preset
    // omits is dropped, not merged); content assets survive from the current form.
    expect(dispatch).toHaveBeenCalledWith({
      type: 'replaceAppearance',
      appearance: {
        ...teal.appearance,
        logo: DEFAULT_APPEARANCE.logo,
        cover: DEFAULT_APPEARANCE.cover,
        branding: DEFAULT_APPEARANCE.branding,
        endings: DEFAULT_APPEARANCE.endings,
      },
    });
  });

  it('resets colors + typography + layout + background to the defaults, leaving assets alone (D1)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText('Reset design to default'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: {
        colors: DEFAULT_APPEARANCE.colors,
        typography: DEFAULT_APPEARANCE.typography,
        layout: DEFAULT_APPEARANCE.layout,
        background: DEFAULT_APPEARANCE.background,
      },
    });
    // The reset never touches brand assets (logo/cover).
    const call = dispatch.mock.calls[0]?.[0];
    expect(call?.patch).not.toHaveProperty('logo');
    expect(call?.patch).not.toHaveProperty('cover');
  });

  it('toggles card border and shadow through the layout controls', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    // Default cardBorder is true → toggling turns it off.
    fireEvent.click(screen.getByLabelText('Card border'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { cardBorder: false } },
    });
    const md = screen.getByText('Md');
    fireEvent.click(md.closest('label') ?? md);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { shadow: 'md' } },
    });
  });

  it('dispatches the input-style variant from the Inputs group (§1.2)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const filled = screen.getByText('Filled');
    fireEvent.click(filled.closest('label') ?? filled);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { inputVariant: 'filled' } },
    });
  });

  it('dispatches the focus style and required mark (§1.7/§1.8)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const glow = screen.getByText('Glow');
    fireEvent.click(glow.closest('label') ?? glow);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { focusStyle: 'glow' } },
    });
    // "Text" also names a colour token, so scope the click to the required-mark row.
    const markRow = screen.getByText('Required mark').closest('div') as HTMLElement;
    const textMark = within(markRow).getByText('Text');
    fireEvent.click(textMark.closest('label') ?? textMark);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { requiredMark: 'text' } },
    });
  });

  it('dispatches the button size from the Buttons group (§1.5)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    // Input size shares the Small/Medium/Large labels, so scope to the row.
    const sizeRow = screen.getByText('Button size').closest('div') as HTMLElement;
    const large = within(sizeRow).getByText('Large');
    fireEvent.click(large.closest('label') ?? large);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { buttonSize: 'lg' } },
    });
  });

  it('dispatches the input size from the Inputs group (§1.9)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    // Button size shares the Small/Medium/Large labels, so scope to the row.
    const sizeRow = screen.getByText('Input size').closest('div') as HTMLElement;
    const large = within(sizeRow).getByText('Large');
    fireEvent.click(large.closest('label') ?? large);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { inputSize: 'lg' } },
    });
  });

  it('switches the page background to a gradient and reveals its controls (§1.1)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    // Solid is the default, so the gradient/scrim controls are hidden.
    expect(screen.queryByLabelText('Gradient from color')).not.toBeInTheDocument();
    const gradient = screen.getByText('Gradient');
    fireEvent.click(gradient.closest('label') ?? gradient);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { background: { type: 'gradient' } },
    });
  });

  it('reveals the gradient pickers and scrim slider when the type is gradient', () => {
    const dispatch = vi.fn();
    const appearance = {
      ...DEFAULT_APPEARANCE,
      background: { ...DEFAULT_APPEARANCE.background, type: 'gradient' as const },
    };
    renderWithProviders(<DesignSettings appearance={appearance} dispatch={dispatch} />);
    expect(screen.getByLabelText('Gradient from color')).toBeInTheDocument();
    expect(screen.getByLabelText('Gradient to color')).toBeInTheDocument();
    // The scrim slider appears for any non-solid background.
    expect(screen.getByText(/Overlay scrim/)).toBeInTheDocument();
  });

  it('dispatches the column mode from the Layout group (§2.1)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const colsRow = screen.getByText('Columns').closest('div') as HTMLElement;
    const two = within(colsRow).getByText('2');
    fireEvent.click(two.closest('label') ?? two);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { columns: '2' } },
    });
  });

  it('toggles subtle animations from the Layout group (§2.4)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByLabelText('Enable subtle animations'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { animations: true } },
    });
  });

  it('shows the card-blur slider only for an image background (§2.6)', () => {
    const dispatch = vi.fn();
    // Solid default: no card-blur control.
    const { unmount } = renderWithProviders(
      <DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />,
    );
    expect(screen.queryByText(/Card blur/)).not.toBeInTheDocument();
    unmount();
    // Image background reveals it.
    const appearance = {
      ...DEFAULT_APPEARANCE,
      background: { ...DEFAULT_APPEARANCE.background, type: 'image' as const },
    };
    renderWithProviders(<DesignSettings appearance={appearance} dispatch={dispatch} />);
    expect(screen.getByText(/Card blur/)).toBeInTheDocument();
  });

  it('sets the logo asset from an https URL', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    // The assets panel is collapsed by default; open it first.
    fireEvent.click(screen.getByText('Brand assets'));
    fireEvent.change(screen.getByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/logo.png' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { logo: { url: 'https://cdn.example.com/logo.png' } },
    });
  });

  // ── Batch 5 (visual-payoff theming) ────────────────────────────
  it('renders the optional semantic color pickers (Batch 5)', () => {
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={vi.fn()} />);
    expect(screen.getByLabelText('Success color')).toBeInTheDocument();
    expect(screen.getByLabelText('Link color')).toBeInTheDocument();
    expect(screen.getByLabelText('Placeholder color')).toBeInTheDocument();
  });

  it('dispatches a button variant change (Batch 5)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const outline = screen.getByText('Outline');
    fireEvent.click(outline.closest('label') ?? outline);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { buttonVariant: 'outline' } },
    });
  });

  it('dispatches a content alignment change (Batch 5)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const centered = screen.getByText('Centered');
    fireEvent.click(centered.closest('label') ?? centered);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { contentAlign: 'center' } },
    });
  });

  it('dispatches a submit-loader change from the Motion group (Batch 5)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const loaderRow = screen.getByText('Submit loader').closest('div') as HTMLElement;
    const off = within(loaderRow).getByText('Off');
    fireEvent.click(off.closest('label') ?? off);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { submitLoader: 'none' } },
    });
  });

  it('shows the image-filter sliders only for an image background (Batch 5)', () => {
    const { unmount } = renderWithProviders(
      <DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={vi.fn()} />,
    );
    expect(screen.queryByText(/Image brightness/)).not.toBeInTheDocument();
    unmount();
    const appearance = {
      ...DEFAULT_APPEARANCE,
      background: { ...DEFAULT_APPEARANCE.background, type: 'image' as const },
    };
    renderWithProviders(<DesignSettings appearance={appearance} dispatch={vi.fn()} />);
    expect(screen.getByText(/Image brightness/)).toBeInTheDocument();
    expect(screen.getByText(/Image grayscale/)).toBeInTheDocument();
  });

  // ── Batch 6 (structured features) ──────────────────────────────
  it('groups presets under their category headings (Batch 6)', () => {
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Presets'));
    // Category headings ('Minimal'/'Warm' are also preset names, so assert
    // categories whose label doesn't collide with a preset name).
    expect(screen.getByText('Classic')).toBeInTheDocument();
    expect(screen.getByText('Cool')).toBeInTheDocument();
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('reveals logo size/align/alt controls only once a logo URL is set (Batch 6)', () => {
    const dispatch = vi.fn();
    const { unmount } = renderWithProviders(
      <DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />,
    );
    fireEvent.click(screen.getByText('Brand assets'));
    expect(screen.queryByLabelText('Logo size')).not.toBeInTheDocument();
    unmount();
    const withLogo = {
      ...DEFAULT_APPEARANCE,
      logo: { url: 'https://cdn.example.com/logo.png' },
    };
    renderWithProviders(<DesignSettings appearance={withLogo} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Brand assets'));
    const sizeRow = screen.getByText('Logo size').closest('div') as HTMLElement;
    const large = within(sizeRow).getByText('Large');
    fireEvent.click(large.closest('label') ?? large);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { logo: { url: 'https://cdn.example.com/logo.png', size: 'lg' } },
    });
  });

  it('dispatches a cover alt-text change once a cover URL is set (Batch 6)', () => {
    const dispatch = vi.fn();
    const withCover = {
      ...DEFAULT_APPEARANCE,
      cover: { url: 'https://cdn.example.com/cover.jpg' },
    };
    renderWithProviders(<DesignSettings appearance={withCover} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Brand assets'));
    fireEvent.change(screen.getByLabelText('Cover alt text'), { target: { value: 'Hero' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { cover: { url: 'https://cdn.example.com/cover.jpg', alt: 'Hero' } },
    });
  });

  it('toggles the "Powered by" footer (Batch 6)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Brand assets'));
    fireEvent.click(screen.getByLabelText('Show powered by'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { branding: { showPoweredBy: true } },
    });
  });

  it('authors per-state ending copy and toggles the redirect countdown (Batch 6)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Ending states'));
    fireEvent.change(screen.getByLabelText('Success heading'), { target: { value: 'Done!' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { endings: { success: { heading: 'Done!' } } },
    });
    fireEvent.click(screen.getByLabelText('Show redirect countdown'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { endings: { showRedirectCountdown: true } },
    });
  });

  it('exports the current design as JSON into a readable field (Batch 6)', () => {
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={vi.fn()} />);
    fireEvent.click(screen.getByText('Export design'));
    const ta = screen.getByTestId('preset-export-json') as HTMLTextAreaElement;
    expect(ta.value).toContain('"ratioFormsPreset"');
    expect(ta.value).toContain('"colors"');
  });

  it('imports a valid preset JSON and applies it wholesale (Batch 6)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const json = JSON.stringify({ ratioFormsPreset: 1, appearance: DEFAULT_APPEARANCE });
    fireEvent.change(screen.getByLabelText('Import preset JSON'), { target: { value: json } });
    fireEvent.click(screen.getByText('Import design'));
    // Full wholesale replace of the entire appearance (every section).
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'replaceAppearance',
        appearance: expect.objectContaining({ colors: DEFAULT_APPEARANCE.colors }),
      }),
    );
  });

  it('surfaces an error on invalid import JSON without dispatching (Batch 6)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText('Import preset JSON'), { target: { value: '{ bad' } });
    fireEvent.click(screen.getByText('Import design'));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/valid JSON/i)).toBeInTheDocument();
  });

  // ── Form-level Custom CSS ──────────────────────────────────────
  it('dispatches an updateAppearance patch when typing into the form Custom CSS textarea', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Custom CSS'));
    fireEvent.change(screen.getByLabelText('Form custom CSS'), {
      target: { value: '.rf-card { border-radius: 12px; }' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { customCss: '.rf-card { border-radius: 12px; }' },
    });
  });

  it('clears the form Custom CSS to undefined on an empty textarea', () => {
    const dispatch = vi.fn();
    const withCss = { ...DEFAULT_APPEARANCE, customCss: '.rf-card { color: red; }' };
    renderWithProviders(<DesignSettings appearance={withCss} dispatch={dispatch} />);
    fireEvent.click(screen.getByText('Custom CSS'));
    fireEvent.change(screen.getByLabelText('Form custom CSS'), { target: { value: '' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { customCss: undefined },
    });
  });
});
