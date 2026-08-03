import type { FormField } from '@shared/schemas/form-schema';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils';
import { DividerSettings } from './divider/settings';
import { HeadingSettings } from './heading/settings';
import { ImageBlockSettings } from './image/settings';
import { PageBreakSettings } from './page_break/settings';
import { ParagraphSettings } from './paragraph/settings';

/** Click an antd Segmented option by its visible label (mirrors DesignSettings tests). */
function clickSegment(label: string) {
  const node = screen.getByText(label);
  fireEvent.click(node.closest('label') ?? node);
}

const headingField = {
  key: 'sec',
  type: 'heading',
  text: 'About you',
  level: 'h2',
  size: 'md',
  align: 'left',
  width: 'full',
} satisfies Extract<FormField, { type: 'heading' }>;

const dividerField = {
  key: 'hr1',
  type: 'divider',
  variant: 'line',
  width: 'full',
} satisfies Extract<FormField, { type: 'divider' }>;

const paragraphField = {
  key: 'intro',
  type: 'paragraph',
  text: 'Hello',
  align: 'left',
  width: 'full',
} satisfies Extract<FormField, { type: 'paragraph' }>;

const imageField = {
  key: 'banner',
  type: 'image',
  url: 'https://cdn.example.com/x.png',
  align: 'left',
  width: 'full',
} satisfies Extract<FormField, { type: 'image' }>;

const pageBreakField = {
  key: 'step2',
  type: 'page_break',
  width: 'full',
} satisfies Extract<FormField, { type: 'page_break' }>;

describe('HeadingSettings (§4.15)', () => {
  it('dispatches updateField for eyebrow, size, and alignment', () => {
    const dispatch = vi.fn();
    renderWithProviders(<HeadingSettings field={headingField} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText('Heading eyebrow'), { target: { value: 'Step 1' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'sec',
      patch: { eyebrow: 'Step 1' },
    });

    clickSegment('LG');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'sec',
      patch: { size: 'lg' },
    });

    clickSegment('Center');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'sec',
      patch: { align: 'center' },
    });
  });

  it('clears the eyebrow to undefined when emptied', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <HeadingSettings field={{ ...headingField, eyebrow: 'Step 1' }} dispatch={dispatch} />,
    );
    fireEvent.change(screen.getByLabelText('Heading eyebrow'), { target: { value: '' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'sec',
      patch: { eyebrow: undefined },
    });
  });
});

describe('DividerSettings (§4.15)', () => {
  it('dispatches updateField for the variant and spacing', () => {
    const dispatch = vi.fn();
    renderWithProviders(<DividerSettings field={dividerField} dispatch={dispatch} />);

    clickSegment('Dashed');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'hr1',
      patch: { variant: 'dashed' },
    });

    fireEvent.change(screen.getByLabelText('Divider spacing'), { target: { value: '32' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'hr1',
      patch: { spacing: 32 },
    });
  });

  it('clears spacing back to the default (undefined) when emptied', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <DividerSettings field={{ ...dividerField, spacing: 32 }} dispatch={dispatch} />,
    );
    fireEvent.change(screen.getByLabelText('Divider spacing'), { target: { value: '' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'hr1',
      patch: { spacing: undefined },
    });
  });
});

describe('ParagraphSettings (§4.15)', () => {
  it('dispatches updateField for alignment', () => {
    const dispatch = vi.fn();
    renderWithProviders(<ParagraphSettings field={paragraphField} dispatch={dispatch} />);
    clickSegment('Center');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'intro',
      patch: { align: 'center' },
    });
  });
});

describe('ImageBlockSettings (§4.15)', () => {
  it('dispatches updateField for align, size, caption, and link', () => {
    const dispatch = vi.fn();
    renderWithProviders(<ImageBlockSettings field={imageField} dispatch={dispatch} />);

    clickSegment('Right');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'banner',
      patch: { align: 'right' },
    });

    clickSegment('M');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'banner',
      patch: { size: 'md' },
    });

    fireEvent.change(screen.getByLabelText('Image caption'), { target: { value: 'A caption' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'banner',
      patch: { caption: 'A caption' },
    });

    fireEvent.change(screen.getByLabelText('Image link URL'), {
      target: { value: 'https://example.com' },
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'banner',
      patch: { linkUrl: 'https://example.com' },
    });
  });

  it('maps the "Full" size option back to undefined', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <ImageBlockSettings field={{ ...imageField, size: 'md' }} dispatch={dispatch} />,
    );
    clickSegment('Full');
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'banner',
      patch: { size: undefined },
    });
  });
});

describe('PageBreakSettings (§1.3)', () => {
  it('patches the step title from the Step title input', () => {
    const dispatch = vi.fn();
    renderWithProviders(<PageBreakSettings field={pageBreakField} dispatch={dispatch} />);
    fireEvent.change(screen.getByLabelText('Step title'), { target: { value: 'Your details' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'step2',
      patch: { title: 'Your details' },
    });
  });

  it('clears the title back to undefined when emptied', () => {
    const dispatch = vi.fn();
    renderWithProviders(
      <PageBreakSettings
        field={{ ...pageBreakField, title: 'Your details' }}
        dispatch={dispatch}
      />,
    );
    fireEvent.change(screen.getByLabelText('Step title'), { target: { value: '' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'updateField',
      key: 'step2',
      patch: { title: undefined },
    });
  });
});
