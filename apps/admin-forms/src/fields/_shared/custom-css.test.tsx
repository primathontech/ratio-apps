import type { FormField } from '@shared/schemas/form-schema';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils';
import { FieldCustomCssSettings } from './controls';

function makeField(overrides: Partial<Extract<FormField, { required: boolean }>> = {}) {
  return {
    key: 'email',
    type: 'email',
    label: 'Email',
    required: true,
    width: 'full',
    showCounter: false,
    ...overrides,
  } as Extract<FormField, { required: boolean }>;
}

describe('FieldCustomCssSettings', () => {
  it('dispatches updateField with the typed CSS on field.customCss', () => {
    const dispatch = vi.fn();
    renderWithProviders(<FieldCustomCssSettings field={makeField()} dispatch={dispatch} />);
    // Expand the collapsible panel.
    fireEvent.click(screen.getByText('Custom CSS'));

    const textarea = screen.getByLabelText('Custom CSS') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'input { color: red; }' } });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'email',
      patch: { customCss: 'input { color: red; }' },
    });
  });

  it('shows a "dropped" warning for CSS that uses url()', () => {
    const dispatch = vi.fn();
    // Field already carries CSS with a url() value so the live sanitizer runs.
    renderWithProviders(
      <FieldCustomCssSettings
        field={makeField({ customCss: 'input { background: url(https://evil.example/x.png); }' })}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByText('Custom CSS'));

    const alert = screen.getByRole('alert', { name: 'Custom CSS warnings' });
    expect(alert.textContent ?? '').toMatch(/dropped/i);
    expect(alert.textContent ?? '').toMatch(/url\(\)/i);
  });

  it('scopes the sanitized preview to the field wrapper', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <FieldCustomCssSettings
        field={makeField({ customCss: 'input { color: green; }' })}
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByText('Custom CSS'));

    const preview = screen.getByLabelText('Sanitized CSS preview');
    expect(preview.textContent ?? '').toContain('[data-field="email"]');
    expect(preview.textContent ?? '').toMatch(/color:\s*green/);
  });
});
