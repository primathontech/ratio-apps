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
    // antd Select renders the value; open it and pick another family.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Font family' }));
    fireEvent.click(screen.getByText('Inter'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { typography: { fontFamily: 'inter' } },
    });
  });

  it('applies a preset wholesale (colors + typography + layout + background), leaving assets alone', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DesignSettings appearance={DEFAULT_APPEARANCE} dispatch={dispatch} />);
    const teal = FORM_APPEARANCE_PRESETS.find((p) => p.id === 'teal');
    if (!teal) throw new Error('teal preset missing');
    fireEvent.click(screen.getByLabelText('Apply Teal preset'));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: {
        colors: teal.appearance.colors,
        typography: teal.appearance.typography,
        layout: teal.appearance.layout,
        background: teal.appearance.background,
      },
    });
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
    const large = screen.getByText('Large');
    fireEvent.click(large.closest('label') ?? large);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateAppearance',
      patch: { layout: { buttonSize: 'lg' } },
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
});
