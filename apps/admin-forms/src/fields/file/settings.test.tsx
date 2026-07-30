import { FORM_FILE_MAX_FILES, type FormField } from '@shared/schemas/form-schema';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test-utils';
import { FileValidationSettings } from './settings';

function makeField(overrides: Partial<Extract<FormField, { type: 'file' }>> = {}) {
  return {
    key: 'resume',
    type: 'file',
    label: 'Resume',
    required: false,
    width: 'full',
    showCounter: false,
    ...overrides,
  } as Extract<FormField, { type: 'file' }>;
}

describe('FileValidationSettings — multiple files', () => {
  it('turning "Allow multiple files" on sets maxFiles > 1', () => {
    const dispatch = vi.fn();
    // maxFiles absent ⇒ single-file, so the switch starts off.
    renderWithProviders(<FileValidationSettings field={makeField()} dispatch={dispatch} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Allow multiple files' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'resume',
      patch: { maxFiles: 2 },
    });
  });

  it('turning it off resets maxFiles to 1 (single file)', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <FileValidationSettings field={makeField({ maxFiles: 4 })} dispatch={dispatch} />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Allow multiple files' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'resume',
      patch: { maxFiles: 1 },
    });
  });

  it('patches the count control and clamps to the FORM_FILE_MAX_FILES cap', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <FileValidationSettings field={makeField({ maxFiles: 3 })} dispatch={dispatch} />,
    );

    fireEvent.change(screen.getByLabelText('Max files'), { target: { value: '5' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'resume',
      patch: { maxFiles: 5 },
    });

    fireEvent.change(screen.getByLabelText('Max files'), {
      target: { value: String(FORM_FILE_MAX_FILES + 3) },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'resume',
      patch: { maxFiles: FORM_FILE_MAX_FILES },
    });
  });

  it('hides the count control while single-file (maxFiles absent)', () => {
    const dispatch = vi.fn();
    renderWithProviders(<FileValidationSettings field={makeField()} dispatch={dispatch} />);
    expect(screen.queryByLabelText('Max files')).toBeNull();
  });
});
