import {
  Button,
  Card,
  Collapse,
  ColorPicker,
  Input,
  Segmented,
  Select,
  Slider,
  Switch,
  Tag,
  Typography,
  UndoOutlined,
} from '@primathonos/orion';
import {
  FORM_BG_IMAGE_FITS,
  FORM_BG_TYPES,
  FORM_BUTTON_ALIGNMENTS,
  FORM_BUTTON_ICONS,
  FORM_BUTTON_SHAPES,
  FORM_BUTTON_SIZES,
  FORM_BUTTON_VARIANTS,
  FORM_COLUMN_MODES,
  FORM_CONTENT_ALIGNS,
  FORM_DENSITIES,
  FORM_EASINGS,
  FORM_ENDING_ICONS,
  FORM_ENDING_STATES,
  FORM_FOCUS_STYLES,
  FORM_FONT_FAMILIES,
  FORM_GRADIENT_DIRS,
  FORM_INPUT_SIZES,
  FORM_INPUT_VARIANTS,
  FORM_LABEL_POSITIONS,
  FORM_LAYOUT_MODES,
  FORM_LOGO_ALIGNS,
  FORM_LOGO_SIZES,
  FORM_MOTION_SPEEDS,
  FORM_REQUIRED_MARKS,
  FORM_SHADOWS,
  FORM_SUBMIT_LOADERS,
  FORM_TYPE_SCALES,
  type FormAppearance,
  type FormEndingState,
} from '@shared/schemas/form-schema';
import { type Dispatch, useState } from 'react';
import { type AppearancePatch, type BuilderAction, DEFAULT_APPEARANCE } from '@/lib/builder-state';
import { bestTextOn, type ContrastState, gradeContrast, scrimmed } from '@/lib/contrast';
import {
  type AppearancePreset,
  exportPresetJson,
  FORM_APPEARANCE_PRESETS,
  importPresetJson,
  PRESET_CATEGORIES,
} from '@/lib/presets';

/** The always-present color tokens (the optional Batch-5 semantic colors —
 * success/link/placeholder — are edited separately). */
type ColorToken = Exclude<keyof FormAppearance['colors'], 'success' | 'link' | 'placeholder'>;

/** Color tokens, in edit order, with the label shown next to each picker. */
const COLOR_TOKENS: { key: ColorToken; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'background', label: 'Form background' },
  { key: 'pageBackground', label: 'Page background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'border', label: 'Border' },
  { key: 'error', label: 'Error' },
  { key: 'buttonText', label: 'Button text' },
];

const FONT_LABELS: Record<(typeof FORM_FONT_FAMILIES)[number], string> = {
  system: 'System default',
  inter: 'Inter',
  roboto: 'Roboto',
  'open-sans': 'Open Sans',
  lato: 'Lato',
  montserrat: 'Montserrat',
  poppins: 'Poppins',
  'source-serif': 'Source Serif',
  merriweather: 'Merriweather',
};

/** Button-size labels — spelled out so they never collide with the shadow segments. */
const BUTTON_SIZE_LABELS: Record<(typeof FORM_BUTTON_SIZES)[number], string> = {
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
};

/** Input-size labels — spelled out, mirroring the button-size control. */
const INPUT_SIZE_LABELS: Record<(typeof FORM_INPUT_SIZES)[number], string> = {
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
};

/** Column-mode labels (§2.1) — 'auto' collapses on narrow embeds. */
const COLUMN_MODE_LABELS: Record<(typeof FORM_COLUMN_MODES)[number], string> = {
  '1': '1',
  '2': '2',
  auto: 'Auto',
};

/** Optional semantic colors (Batch 5) — absent ⇒ derived at the SDK. The picker
 * shows the derived fallback so the swatch is never empty. */
const OPTIONAL_COLOR_TOKENS: {
  key: 'success' | 'link' | 'placeholder';
  label: string;
  fallback: (c: FormAppearance['colors']) => string;
}[] = [
  { key: 'success', label: 'Success', fallback: (c) => c.primary },
  { key: 'link', label: 'Link', fallback: (c) => c.primary },
  { key: 'placeholder', label: 'Placeholder', fallback: (c) => c.muted },
];

/** Required + optional swatches as one list, so they render in a single even
 * 2-column grid (12 items = 6 full rows) instead of two grids that each leave a
 * lonely odd-one-out cell. Optional tokens keep their derived fallback. */
const ALL_COLOR_SWATCHES: {
  key: keyof FormAppearance['colors'];
  label: string;
  fallback?: (c: FormAppearance['colors']) => string;
}[] = [...COLOR_TOKENS, ...OPTIONAL_COLOR_TOKENS];

/** Content-alignment labels — 'Centered' avoids colliding with the button
 * alignment's 'Center' segment. */
const CONTENT_ALIGN_LABELS: Record<(typeof FORM_CONTENT_ALIGNS)[number], string> = {
  left: 'Left',
  center: 'Centered',
};

/** Card-vs-flat surface labels. */
const LAYOUT_MODE_LABELS: Record<(typeof FORM_LAYOUT_MODES)[number], string> = {
  card: 'Card',
  flat: 'Flat',
};

/** Motion-speed labels. */
const MOTION_SPEED_LABELS: Record<(typeof FORM_MOTION_SPEEDS)[number], string> = {
  slow: 'Slow',
  normal: 'Normal',
  fast: 'Fast',
};

/** Submit-loader labels — 'Off' reads clearer than 'None'. */
const SUBMIT_LOADER_LABELS: Record<(typeof FORM_SUBMIT_LOADERS)[number], string> = {
  spinner: 'Spinner',
  none: 'Off',
};

/** Type-scale labels for the pairing Select. */
const TYPE_SCALE_LABELS: Record<(typeof FORM_TYPE_SCALES)[number], string> = {
  'minor-third': 'Minor third',
  'major-third': 'Major third',
  'perfect-fourth': 'Perfect fourth',
};

/** Logo-size labels (Batch 6) — spelled out to avoid colliding with segments. */
const LOGO_SIZE_LABELS: Record<(typeof FORM_LOGO_SIZES)[number], string> = {
  sm: 'Small',
  md: 'Medium',
  lg: 'Large',
};

/** End-state labels (Batch 6) shown as the copy-editor sub-headings. */
const ENDING_STATE_LABELS: Record<FormEndingState, string> = {
  success: 'Success',
  closed: 'Closed',
  expired: 'Expired',
  unavailable: 'Unavailable',
  error: 'Error',
};

/** `fix` = token to flip black/white (text pairs); `pageAware` = resolve scrim/gradient/image. */
interface ContrastPair {
  fg: ColorToken;
  bg: ColorToken;
  label: string;
  kind: 'text' | 'nonText';
  fix?: ColorToken;
  pageAware?: boolean;
}

const CONTRAST_PAIRS: ContrastPair[] = [
  { fg: 'text', bg: 'background', label: 'Text on form', kind: 'text', fix: 'text' },
  {
    fg: 'text',
    bg: 'pageBackground',
    label: 'Text on page',
    kind: 'text',
    fix: 'text',
    pageAware: true,
  },
  { fg: 'text', bg: 'surface', label: 'Text on inputs', kind: 'text', fix: 'text' },
  { fg: 'muted', bg: 'background', label: 'Muted text on form', kind: 'text', fix: 'muted' },
  { fg: 'buttonText', bg: 'primary', label: 'Button text', kind: 'text', fix: 'buttonText' },
  { fg: 'border', bg: 'background', label: 'Field border', kind: 'nonText' },
  { fg: 'primary', bg: 'background', label: 'Focus ring', kind: 'nonText' },
];

/** Advisory styling per state — colourblind-safe (glyph + word carry meaning). */
const CONTRAST_STATE: Record<ContrastState, { glyph: string; word: string; color: string }> = {
  good: { glyph: '●', word: 'Good contrast', color: '#067647' },
  ok: { glyph: '◐', word: 'Large text only', color: '#b54708' },
  low: { glyph: '▲', word: 'Low contrast', color: '#b54708' },
};

interface Props {
  /** Resolved appearance (defaults filled) — never partial. */
  appearance: FormAppearance;
  dispatch: Dispatch<BuilderAction>;
}

/** The right-panel "Design" tab: colours, typography and layout controls. */
export function DesignSettings({ appearance, dispatch }: Props) {
  const patch = (p: AppearancePatch) => dispatch({ type: 'updateAppearance', patch: p });
  const { colors, typography, layout, background } = appearance;

  // A preset swaps colors/typography/layout/background wholesale; logo/cover and
  // the Batch 6 branding/endings are content, so they survive (catalog note).
  const applyPreset = (p: AppearancePreset) =>
    dispatch({
      type: 'replaceAppearance',
      // Style swapped wholesale from the preset (so an optional token the preset
      // omits, e.g. colors.success, is DROPPED not kept); content (logo/cover/
      // branding/endings) survives.
      appearance: {
        ...p.appearance,
        logo: appearance.logo,
        cover: appearance.cover,
        branding: appearance.branding,
        endings: appearance.endings,
      },
    });

  // Import replaces the appearance wholesale (every section, including brand
  // assets/branding/endings) — the imported object is a full, schema-valid
  // FormAppearance.
  const applyImported = (a: FormAppearance) =>
    dispatch({ type: 'replaceAppearance', appearance: a });

  // Batch 6 — merge one or more keys into the endings object (composing the
  // object when it's the first authored field). All endings fields are optional.
  const patchEndings = (p: Partial<NonNullable<FormAppearance['endings']>>) =>
    patch({ endings: { ...appearance.endings, ...p } });
  // Replace one end state's whole panel (the editor composes it). The computed
  // key is cast back to the partial endings shape — the runtime value is correct.
  const setEndingPanel = (state: FormEndingState, panel: EndingPanel) =>
    patchEndings({ [state]: panel } as Partial<NonNullable<FormAppearance['endings']>>);

  // Reset restores the built-in defaults for the same four sections a preset
  // touches; brand assets (logo/cover) are content, so they stay put.
  const resetToDefault = () =>
    patch({
      colors: DEFAULT_APPEARANCE.colors,
      typography: DEFAULT_APPEARANCE.typography,
      layout: DEFAULT_APPEARANCE.layout,
      background: DEFAULT_APPEARANCE.background,
    });

  return (
    <Card title="Design" className="design-settings">
      {/* Presets + design transfer live in one enclosing box so the top of the
          panel reads as a single grouped section, not loose floating rows. */}
      <div
        style={{
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          padding: '12px',
          marginBottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <PresetRow onApply={applyPreset} onReset={resetToDefault} />
        <PresetTransfer appearance={appearance} onImport={applyImported} />
      </div>
      <Collapse
        accordion
        defaultActiveKey={['colors']}
        items={[
          {
            key: 'colors',
            forceRender: true,
            label: 'Colors',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Required + optional swatches in one even 2-column grid, so no
                    row is left with a lonely empty cell (labels stay single-line
                    so paired pickers share a baseline). */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 12,
                  }}
                >
                  {ALL_COLOR_SWATCHES.map(({ key, label, fallback }) => (
                    <div
                      key={key}
                      style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}
                    >
                      <Typography.Text
                        title={label}
                        style={{
                          fontSize: 13,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {label}
                      </Typography.Text>
                      <ColorPicker
                        aria-label={`${label} color`}
                        value={colors[key] ?? fallback?.(colors) ?? colors.primary}
                        format="hex"
                        showText
                        onChangeComplete={(c) => patch({ colors: { [key]: c.toHexString() } })}
                      />
                    </div>
                  ))}
                </div>
                <ContrastReport appearance={appearance} patch={patch} />
              </div>
            ),
          },
          {
            key: 'typography',
            forceRender: true,
            label: 'Typography',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label="Font family">
                  <Select
                    aria-label="Font family"
                    style={{ width: '100%' }}
                    value={typography.fontFamily}
                    onChange={(value) =>
                      patch({
                        typography: {
                          fontFamily: value as FormAppearance['typography']['fontFamily'],
                        },
                      })
                    }
                    options={FORM_FONT_FAMILIES.map((f) => ({ value: f, label: FONT_LABELS[f] }))}
                  />
                </Row>
                <Row label={`Base size (${typography.baseSize}px)`}>
                  <Slider
                    aria-label="Base font size"
                    min={12}
                    max={20}
                    value={typography.baseSize}
                    onChange={(value) => patch({ typography: { baseSize: value as number } })}
                  />
                </Row>
                <Row label="Custom Google font (name)">
                  <Input
                    aria-label="Custom Google font"
                    placeholder="e.g. Figtree"
                    value={typography.customGoogleFont ?? ''}
                    style={{ width: '100%' }}
                    onChange={(e) =>
                      patch({
                        typography: { customGoogleFont: e.target.value.trim() || undefined },
                      })
                    }
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Overrides the preset above; must be on Google Fonts.
                  </Typography.Text>
                </Row>
                {/* Batch 5 — heading/body font pairing, type scale, line-heights. */}
                <Row label="Heading font">
                  <Select
                    aria-label="Heading font"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder="Same as body"
                    value={typography.headingFont}
                    onChange={(value) =>
                      patch({
                        typography: {
                          headingFont: value as FormAppearance['typography']['headingFont'],
                        },
                      })
                    }
                    options={FORM_FONT_FAMILIES.map((f) => ({ value: f, label: FONT_LABELS[f] }))}
                  />
                </Row>
                <Row label="Body font">
                  <Select
                    aria-label="Body font"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder="Default"
                    value={typography.bodyFont}
                    onChange={(value) =>
                      patch({
                        typography: {
                          bodyFont: value as FormAppearance['typography']['bodyFont'],
                        },
                      })
                    }
                    options={FORM_FONT_FAMILIES.map((f) => ({ value: f, label: FONT_LABELS[f] }))}
                  />
                </Row>
                <Row label="Type scale">
                  <Select
                    aria-label="Type scale"
                    style={{ width: '100%' }}
                    allowClear
                    placeholder="Default"
                    value={typography.scaleRatio}
                    onChange={(value) =>
                      patch({
                        typography: {
                          scaleRatio: value as FormAppearance['typography']['scaleRatio'],
                        },
                      })
                    }
                    options={FORM_TYPE_SCALES.map((s) => ({
                      value: s,
                      label: TYPE_SCALE_LABELS[s],
                    }))}
                  />
                </Row>
                <Row label={`Body line height (${typography.bodyLineHeight ?? 'auto'})`}>
                  <Slider
                    aria-label="Body line height"
                    min={1.1}
                    max={2}
                    step={0.1}
                    value={typography.bodyLineHeight ?? 1.5}
                    onChange={(value) => patch({ typography: { bodyLineHeight: value as number } })}
                  />
                </Row>
                <Row label={`Heading line height (${typography.headingLineHeight ?? 'auto'})`}>
                  <Slider
                    aria-label="Heading line height"
                    min={1}
                    max={1.6}
                    step={0.1}
                    value={typography.headingLineHeight ?? 1.2}
                    onChange={(value) =>
                      patch({ typography: { headingLineHeight: value as number } })
                    }
                  />
                </Row>
              </div>
            ),
          },
          {
            key: 'layout',
            forceRender: true,
            label: 'Layout',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label={`Corner radius (${layout.radius}px)`}>
                  <Slider
                    aria-label="Corner radius"
                    min={0}
                    max={32}
                    value={layout.radius}
                    onChange={(value) => patch({ layout: { radius: value as number } })}
                  />
                </Row>
                <Row label="Density">
                  <Segmented
                    aria-label="Density"
                    value={layout.density}
                    onChange={(value) =>
                      patch({ layout: { density: value as FormAppearance['layout']['density'] } })
                    }
                    options={FORM_DENSITIES.map((d) => ({ value: d, label: titleCase(d) }))}
                  />
                </Row>
                <Row label={`Form width (${layout.maxWidth}px)`}>
                  <Slider
                    aria-label="Form width"
                    min={280}
                    max={960}
                    step={10}
                    disabled={layout.fluidWidth}
                    value={layout.maxWidth}
                    onChange={(value) => patch({ layout: { maxWidth: value as number } })}
                  />
                </Row>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    aria-label="Fluid width"
                    checked={layout.fluidWidth}
                    onChange={(checked) => patch({ layout: { fluidWidth: checked } })}
                  />
                  <Typography.Text>Fluid width (ignore max width)</Typography.Text>
                </div>
                <Row label="Label position">
                  <Segmented
                    aria-label="Label position"
                    value={layout.labelPosition}
                    onChange={(value) =>
                      patch({
                        layout: {
                          labelPosition: value as FormAppearance['layout']['labelPosition'],
                        },
                      })
                    }
                    options={FORM_LABEL_POSITIONS.map((p) => ({ value: p, label: titleCase(p) }))}
                  />
                </Row>
                <Row label="Content alignment">
                  <Segmented
                    aria-label="Content alignment"
                    value={layout.contentAlign}
                    onChange={(value) =>
                      patch({
                        layout: { contentAlign: value as FormAppearance['layout']['contentAlign'] },
                      })
                    }
                    options={FORM_CONTENT_ALIGNS.map((a) => ({
                      value: a,
                      label: CONTENT_ALIGN_LABELS[a],
                    }))}
                  />
                </Row>
                <Row label="Card style">
                  <Segmented
                    aria-label="Card style"
                    value={layout.layoutMode}
                    onChange={(value) =>
                      patch({
                        layout: { layoutMode: value as FormAppearance['layout']['layoutMode'] },
                      })
                    }
                    options={FORM_LAYOUT_MODES.map((m) => ({
                      value: m,
                      label: LAYOUT_MODE_LABELS[m],
                    }))}
                  />
                </Row>
                <Row label="Columns">
                  <Segmented
                    aria-label="Columns"
                    value={layout.columns}
                    onChange={(value) =>
                      patch({ layout: { columns: value as FormAppearance['layout']['columns'] } })
                    }
                    options={FORM_COLUMN_MODES.map((c) => ({
                      value: c,
                      label: COLUMN_MODE_LABELS[c],
                    }))}
                  />
                </Row>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    aria-label="Enable subtle animations"
                    checked={layout.animations}
                    onChange={(checked) => patch({ layout: { animations: checked } })}
                  />
                  <Typography.Text>Enable subtle animations</Typography.Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    aria-label="Card border"
                    checked={layout.cardBorder}
                    onChange={(checked) => patch({ layout: { cardBorder: checked } })}
                  />
                  <Typography.Text>Card border</Typography.Text>
                </div>
                <Row label="Shadow">
                  <Segmented
                    aria-label="Shadow"
                    value={layout.shadow}
                    onChange={(value) =>
                      patch({ layout: { shadow: value as FormAppearance['layout']['shadow'] } })
                    }
                    options={FORM_SHADOWS.map((s) => ({ value: s, label: titleCase(s) }))}
                  />
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Advanced spacing (overrides the density preset)
                </Typography.Text>
                <Row label={`Field gap (${layout.fieldGap ?? 'auto'})`}>
                  <Slider
                    aria-label="Field gap"
                    min={6}
                    max={40}
                    value={layout.fieldGap ?? 16}
                    onChange={(value) => patch({ layout: { fieldGap: value as number } })}
                  />
                </Row>
                <Row label={`Input padding (${layout.inputPadY ?? 'auto'})`}>
                  <Slider
                    aria-label="Input padding"
                    min={4}
                    max={18}
                    value={layout.inputPadY ?? 10}
                    onChange={(value) => patch({ layout: { inputPadY: value as number } })}
                  />
                </Row>
                <Row label={`Horizontal padding (${layout.inputPadX ?? 'auto'})`}>
                  <Slider
                    aria-label="Horizontal padding"
                    min={4}
                    max={24}
                    value={layout.inputPadX ?? 10}
                    onChange={(value) => patch({ layout: { inputPadX: value as number } })}
                  />
                </Row>
                <Row label={`Card padding (${layout.cardPadding ?? 'auto'})`}>
                  <Slider
                    aria-label="Card padding"
                    min={8}
                    max={64}
                    value={layout.cardPadding ?? 28}
                    onChange={(value) => patch({ layout: { cardPadding: value as number } })}
                  />
                </Row>
              </div>
            ),
          },
          {
            key: 'inputs',
            forceRender: true,
            label: 'Inputs',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label="Input style">
                  <Segmented
                    aria-label="Input style"
                    value={layout.inputVariant}
                    onChange={(value) =>
                      patch({
                        layout: {
                          inputVariant: value as FormAppearance['layout']['inputVariant'],
                        },
                      })
                    }
                    options={FORM_INPUT_VARIANTS.map((v) => ({ value: v, label: titleCase(v) }))}
                  />
                </Row>
                <Row label="Input size">
                  <Segmented
                    aria-label="Input size"
                    value={layout.inputSize}
                    onChange={(value) =>
                      patch({
                        layout: { inputSize: value as FormAppearance['layout']['inputSize'] },
                      })
                    }
                    options={FORM_INPUT_SIZES.map((s) => ({
                      value: s,
                      label: INPUT_SIZE_LABELS[s],
                    }))}
                  />
                </Row>
                <Row label="Focus style">
                  <Segmented
                    aria-label="Focus style"
                    value={layout.focusStyle}
                    onChange={(value) =>
                      patch({
                        layout: { focusStyle: value as FormAppearance['layout']['focusStyle'] },
                      })
                    }
                    options={FORM_FOCUS_STYLES.map((v) => ({ value: v, label: titleCase(v) }))}
                  />
                </Row>
                <Row label={`Focus width (${layout.focusWidth}px)`}>
                  <Slider
                    aria-label="Focus width"
                    min={1}
                    max={4}
                    value={layout.focusWidth}
                    onChange={(value) => patch({ layout: { focusWidth: value as number } })}
                  />
                </Row>
                <Row label="Required mark">
                  <Segmented
                    aria-label="Required mark"
                    value={layout.requiredMark}
                    onChange={(value) =>
                      patch({
                        layout: {
                          requiredMark: value as FormAppearance['layout']['requiredMark'],
                        },
                      })
                    }
                    options={FORM_REQUIRED_MARKS.map((v) => ({ value: v, label: titleCase(v) }))}
                  />
                </Row>
              </div>
            ),
          },
          {
            key: 'buttons',
            forceRender: true,
            label: 'Buttons',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label="Button variant">
                  <Segmented
                    aria-label="Button variant"
                    value={layout.buttonVariant}
                    onChange={(value) =>
                      patch({
                        layout: {
                          buttonVariant: value as FormAppearance['layout']['buttonVariant'],
                        },
                      })
                    }
                    options={FORM_BUTTON_VARIANTS.map((v) => ({ value: v, label: titleCase(v) }))}
                  />
                </Row>
                <Row label="Button shape">
                  <Segmented
                    aria-label="Button shape"
                    value={layout.buttonShape}
                    onChange={(value) =>
                      patch({
                        layout: { buttonShape: value as FormAppearance['layout']['buttonShape'] },
                      })
                    }
                    options={FORM_BUTTON_SHAPES.map((s) => ({ value: s, label: titleCase(s) }))}
                  />
                </Row>
                <Row label="Button size">
                  <Segmented
                    aria-label="Button size"
                    value={layout.buttonSize}
                    onChange={(value) =>
                      patch({
                        layout: { buttonSize: value as FormAppearance['layout']['buttonSize'] },
                      })
                    }
                    options={FORM_BUTTON_SIZES.map((s) => ({
                      value: s,
                      label: BUTTON_SIZE_LABELS[s],
                    }))}
                  />
                </Row>
                <Row label="Button icon">
                  <Select
                    aria-label="Button icon"
                    style={{ width: '100%' }}
                    value={layout.buttonIcon}
                    onChange={(value) =>
                      patch({
                        layout: { buttonIcon: value as FormAppearance['layout']['buttonIcon'] },
                      })
                    }
                    options={FORM_BUTTON_ICONS.map((i) => ({ value: i, label: titleCase(i) }))}
                  />
                </Row>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    aria-label="Full-width button"
                    checked={layout.fullWidthButton}
                    onChange={(checked) => patch({ layout: { fullWidthButton: checked } })}
                  />
                  <Typography.Text>Full-width button</Typography.Text>
                </div>
                <Row label="Button alignment">
                  <Segmented
                    aria-label="Button alignment"
                    // Moot when the button spans the full width.
                    disabled={layout.fullWidthButton}
                    value={layout.buttonAlign}
                    onChange={(value) =>
                      patch({
                        layout: { buttonAlign: value as FormAppearance['layout']['buttonAlign'] },
                      })
                    }
                    options={FORM_BUTTON_ALIGNMENTS.map((a) => ({ value: a, label: titleCase(a) }))}
                  />
                </Row>
              </div>
            ),
          },
          {
            key: 'motion',
            forceRender: true,
            label: 'Motion',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label="Motion speed">
                  <Segmented
                    aria-label="Motion speed"
                    // Only meaningful once animations are enabled (Layout tab).
                    disabled={!layout.animations}
                    value={layout.motionSpeed}
                    onChange={(value) =>
                      patch({
                        layout: { motionSpeed: value as FormAppearance['layout']['motionSpeed'] },
                      })
                    }
                    options={FORM_MOTION_SPEEDS.map((s) => ({
                      value: s,
                      label: MOTION_SPEED_LABELS[s],
                    }))}
                  />
                </Row>
                <Row label="Easing">
                  <Segmented
                    aria-label="Easing"
                    disabled={!layout.animations}
                    value={layout.easing}
                    onChange={(value) =>
                      patch({ layout: { easing: value as FormAppearance['layout']['easing'] } })
                    }
                    options={FORM_EASINGS.map((e) => ({ value: e, label: titleCase(e) }))}
                  />
                </Row>
                <Row label={`Focus offset (${layout.focusOffset}px)`}>
                  <Slider
                    aria-label="Focus offset"
                    min={0}
                    max={6}
                    value={layout.focusOffset}
                    onChange={(value) => patch({ layout: { focusOffset: value as number } })}
                  />
                </Row>
                <Row label="Submit loader">
                  <Segmented
                    aria-label="Submit loader"
                    value={layout.submitLoader}
                    onChange={(value) =>
                      patch({
                        layout: { submitLoader: value as FormAppearance['layout']['submitLoader'] },
                      })
                    }
                    options={FORM_SUBMIT_LOADERS.map((s) => ({
                      value: s,
                      label: SUBMIT_LOADER_LABELS[s],
                    }))}
                  />
                </Row>
              </div>
            ),
          },
          {
            key: 'background',
            forceRender: true,
            label: 'Background',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label="Type">
                  <Segmented
                    aria-label="Background type"
                    value={background.type}
                    onChange={(value) =>
                      patch({ background: { type: value as FormAppearance['background']['type'] } })
                    }
                    options={FORM_BG_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
                  />
                </Row>
                {background.type === 'gradient' && (
                  <>
                    <Row label="Gradient from">
                      <ColorPicker
                        aria-label="Gradient from color"
                        value={background.gradientFrom ?? colors.pageBackground}
                        format="hex"
                        showText
                        onChangeComplete={(c) =>
                          patch({ background: { gradientFrom: c.toHexString() } })
                        }
                      />
                    </Row>
                    <Row label="Gradient to">
                      <ColorPicker
                        aria-label="Gradient to color"
                        value={background.gradientTo ?? colors.pageBackground}
                        format="hex"
                        showText
                        onChangeComplete={(c) =>
                          patch({ background: { gradientTo: c.toHexString() } })
                        }
                      />
                    </Row>
                    <Row label="Direction">
                      <Select
                        aria-label="Gradient direction"
                        style={{ width: '100%' }}
                        value={background.gradientDir}
                        onChange={(value) =>
                          patch({
                            background: {
                              gradientDir: value as FormAppearance['background']['gradientDir'],
                            },
                          })
                        }
                        options={FORM_GRADIENT_DIRS.map((d) => ({ value: d, label: d }))}
                      />
                    </Row>
                  </>
                )}
                {background.type === 'image' && (
                  <>
                    <AssetInput
                      label="Image URL (https)"
                      ariaLabel="Background image URL"
                      value={background.imageUrl ?? ''}
                      onChange={(url) => patch({ background: { imageUrl: url || undefined } })}
                    />
                    <Row label="Fit">
                      <Segmented
                        aria-label="Background image fit"
                        value={background.imageFit}
                        onChange={(value) =>
                          patch({
                            background: {
                              imageFit: value as FormAppearance['background']['imageFit'],
                            },
                          })
                        }
                        options={FORM_BG_IMAGE_FITS.map((f) => ({ value: f, label: titleCase(f) }))}
                      />
                    </Row>
                    <Row label={`Card blur (${background.cardBlur}px)`}>
                      <Slider
                        aria-label="Card blur"
                        min={0}
                        max={20}
                        value={background.cardBlur}
                        onChange={(value) => patch({ background: { cardBlur: value as number } })}
                      />
                    </Row>
                    {/* Batch 5 — filters on the image layer only (not the card). */}
                    <Row label={`Image brightness (${background.imageBrightness.toFixed(2)})`}>
                      <Slider
                        aria-label="Image brightness"
                        min={0.5}
                        max={1.5}
                        step={0.05}
                        value={background.imageBrightness}
                        onChange={(value) =>
                          patch({ background: { imageBrightness: value as number } })
                        }
                      />
                    </Row>
                    <Row label={`Image blur (${background.imageBlur}px)`}>
                      <Slider
                        aria-label="Image blur"
                        min={0}
                        max={20}
                        value={background.imageBlur}
                        onChange={(value) => patch({ background: { imageBlur: value as number } })}
                      />
                    </Row>
                    <Row label={`Image grayscale (${background.imageGrayscale.toFixed(2)})`}>
                      <Slider
                        aria-label="Image grayscale"
                        min={0}
                        max={1}
                        step={0.05}
                        value={background.imageGrayscale}
                        onChange={(value) =>
                          patch({ background: { imageGrayscale: value as number } })
                        }
                      />
                    </Row>
                  </>
                )}
                {background.type !== 'solid' && (
                  <Row label={`Overlay scrim (${background.scrim.toFixed(2)})`}>
                    <Slider
                      aria-label="Overlay scrim"
                      min={0}
                      max={0.8}
                      step={0.05}
                      value={background.scrim}
                      onChange={(value) => patch({ background: { scrim: value as number } })}
                    />
                  </Row>
                )}
              </div>
            ),
          },
          {
            key: 'assets',
            forceRender: true,
            label: 'Brand assets',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <AssetInput
                  label="Logo URL (https)"
                  ariaLabel="Logo URL"
                  value={appearance.logo?.url ?? ''}
                  // Setting a URL keeps the existing size/align/alt; clearing it
                  // drops the whole logo. Sub-controls below only show with a URL.
                  onChange={(url) => patch({ logo: url ? { ...appearance.logo, url } : undefined })}
                />
                {appearance.logo?.url && (
                  <>
                    <Row label="Logo size">
                      <Segmented
                        aria-label="Logo size"
                        value={appearance.logo.size ?? 'md'}
                        onChange={(value) =>
                          appearance.logo &&
                          patch({
                            logo: {
                              ...appearance.logo,
                              size: value as (typeof FORM_LOGO_SIZES)[number],
                            },
                          })
                        }
                        options={FORM_LOGO_SIZES.map((s) => ({
                          value: s,
                          label: LOGO_SIZE_LABELS[s],
                        }))}
                      />
                    </Row>
                    <Row label="Logo alignment">
                      <Segmented
                        aria-label="Logo alignment"
                        value={appearance.logo.align ?? 'left'}
                        onChange={(value) =>
                          appearance.logo &&
                          patch({
                            logo: {
                              ...appearance.logo,
                              align: value as 'left' | 'center' | 'right',
                            },
                          })
                        }
                        options={FORM_LOGO_ALIGNS.map((a) => ({ value: a, label: titleCase(a) }))}
                      />
                    </Row>
                    <Row label="Logo alt text">
                      <Input
                        aria-label="Logo alt text"
                        placeholder="Describe the logo (optional)"
                        value={appearance.logo.alt ?? ''}
                        style={{ width: '100%' }}
                        onChange={(e) =>
                          appearance.logo &&
                          patch({
                            logo: { ...appearance.logo, alt: e.target.value || undefined },
                          })
                        }
                      />
                    </Row>
                  </>
                )}
                <AssetInput
                  label="Cover image URL (https)"
                  ariaLabel="Cover URL"
                  value={appearance.cover?.url ?? ''}
                  onChange={(url) =>
                    patch({ cover: url ? { ...appearance.cover, url } : undefined })
                  }
                />
                {appearance.cover?.url && (
                  <>
                    <Row label={`Cover height (${appearance.cover.height ?? 180}px)`}>
                      <Slider
                        aria-label="Cover height"
                        min={80}
                        max={480}
                        value={appearance.cover.height ?? 180}
                        onChange={(value) =>
                          appearance.cover &&
                          patch({ cover: { ...appearance.cover, height: value as number } })
                        }
                      />
                    </Row>
                    <Row label={`Cover overlay (${(appearance.cover.overlay ?? 0).toFixed(2)})`}>
                      <Slider
                        aria-label="Cover overlay"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={appearance.cover.overlay ?? 0}
                        onChange={(value) =>
                          appearance.cover &&
                          patch({ cover: { ...appearance.cover, overlay: value as number } })
                        }
                      />
                    </Row>
                    <Row label={`Cover blur (${appearance.cover.blur ?? 0}px)`}>
                      <Slider
                        aria-label="Cover blur"
                        min={0}
                        max={20}
                        value={appearance.cover.blur ?? 0}
                        onChange={(value) =>
                          appearance.cover &&
                          patch({ cover: { ...appearance.cover, blur: value as number } })
                        }
                      />
                    </Row>
                    <Row label="Cover alt text">
                      <Input
                        aria-label="Cover alt text"
                        placeholder="Describe the cover image (optional)"
                        value={appearance.cover.alt ?? ''}
                        style={{ width: '100%' }}
                        onChange={(e) =>
                          appearance.cover &&
                          patch({
                            cover: { ...appearance.cover, alt: e.target.value || undefined },
                          })
                        }
                      />
                    </Row>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    aria-label="Show powered by"
                    checked={appearance.branding.showPoweredBy}
                    onChange={(checked) => patch({ branding: { showPoweredBy: checked } })}
                  />
                  <Typography.Text>Show "Powered by" footer</Typography.Text>
                </div>
              </div>
            ),
          },
          {
            key: 'endings',
            forceRender: true,
            label: 'Ending states',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Row label={`Redirect delay (${appearance.endings?.redirectDelaySeconds ?? 2}s)`}>
                  <Slider
                    aria-label="Redirect delay"
                    min={0}
                    max={30}
                    value={appearance.endings?.redirectDelaySeconds ?? 2}
                    onChange={(value) => patchEndings({ redirectDelaySeconds: value as number })}
                  />
                </Row>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch
                    aria-label="Show redirect countdown"
                    checked={appearance.endings?.showRedirectCountdown ?? false}
                    onChange={(checked) => patchEndings({ showRedirectCountdown: checked })}
                  />
                  <Typography.Text>Show redirect countdown</Typography.Text>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Per-state copy. Blank fields use the built-in text (success also chains to the
                  form's success message).
                </Typography.Text>
                {FORM_ENDING_STATES.map((state) => (
                  <EndingStateEditor
                    key={state}
                    state={state}
                    panel={appearance.endings?.[state]}
                    onChange={(panel) => setEndingPanel(state, panel)}
                  />
                ))}
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function PresetRow({
  onApply,
  onReset,
}: {
  onApply: (preset: AppearancePreset) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* Custom header row: the disclosure toggle (chevron + title) and the Reset
          button sit on one flex row sharing a single centre line, so they always
          align — antd's Collapse `extra` slot sat the button a touch too high. */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
            border: 'none',
            background: 'none',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{ color: '#8c8c8c', fontSize: 10, width: 10, display: 'inline-flex' }}
          >
            {open ? '▼' : '▶'}
          </span>
          <Typography.Text strong style={{ fontSize: 13 }}>
            Presets
          </Typography.Text>
        </button>
        <Button
          type="text"
          size="small"
          icon={<UndoOutlined />}
          aria-label="Reset design to default"
          onClick={onReset}
        >
          Reset to default
        </Button>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {/* Batch 6: presets are grouped under their category heading, in the
              declared category order; empty categories are skipped. */}
          {PRESET_CATEGORIES.map((category) => {
            const inCategory = FORM_APPEARANCE_PRESETS.filter((p) => p.category === category);
            if (inCategory.length === 0) return null;
            return (
              <div key={category} style={{ marginBottom: 10 }}>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}
                >
                  {category}
                </Typography.Text>
                <div
                  style={{
                    display: 'grid',
                    // Even columns that fill the panel width (flex-wrap left-packed them).
                    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  {inCategory.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      aria-label={`Apply ${preset.name} preset`}
                      onClick={() => onApply(preset)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                        padding: 6,
                        border: '1px solid #e5e5e5',
                        borderRadius: 8,
                        background: '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <PresetThumbnail id={preset.id} appearance={preset.appearance} />
                      <span style={{ fontSize: 12 }}>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Admin-only preset JSON export/import (Batch 6). Export serializes the current
 * appearance into a textarea (and offers a download); import validates pasted
 * JSON through the SAME appearanceSchema before applying, so nothing unvalidated
 * ever reaches the stored appearance. Zero renderer risk — it only produces a
 * schema-valid FormAppearance the builder already knows how to render.
 */
function PresetTransfer({
  appearance,
  onImport,
}: {
  appearance: FormAppearance;
  onImport: (a: FormAppearance) => void;
}) {
  const [exported, setExported] = useState('');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  const handleExport = () => {
    const json = exportPresetJson(appearance);
    setExported(json);
    // Best-effort download; the textarea is the reliable path (and what tests read).
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ratio-form-preset.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Non-browser/test environments without Blob/URL — the textarea still works.
    }
  };

  const handleImport = () => {
    const result = importPresetJson(importText);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    setImportError('');
    onImport(result.appearance);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        Transfer design
      </Typography.Text>
      {/* Two equal-width outline buttons that read as a matched pair. Import is
          left enabled (Orion renders disabled buttons as a heavy muted-blue
          block); pasting nothing just surfaces the inline error below. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="small" block onClick={handleExport}>
          Export design
        </Button>
        <Button size="small" block onClick={handleImport}>
          Import design
        </Button>
      </div>
      {exported && (
        <Input.TextArea
          aria-label="Exported preset JSON"
          data-testid="preset-export-json"
          readOnly
          value={exported}
          rows={4}
          style={{ fontFamily: 'monospace', fontSize: 11 }}
        />
      )}
      <Input.TextArea
        aria-label="Import preset JSON"
        placeholder="Paste preset JSON to import…"
        value={importText}
        rows={2}
        onChange={(e) => setImportText(e.target.value)}
        style={{ fontFamily: 'monospace', fontSize: 11 }}
      />
      {importError && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          {importError}
        </Typography.Text>
      )}
    </div>
  );
}

/** Ending-icon labels — spelled out for the Select. */
const ENDING_ICON_LABELS: Record<(typeof FORM_ENDING_ICONS)[number], string> = {
  none: 'None',
  check: 'Check',
  info: 'Info',
  warning: 'Warning',
  lock: 'Lock',
  clock: 'Clock',
};

/** One end state's authored copy (icon + heading + body), all optional. */
type EndingPanel = NonNullable<NonNullable<FormAppearance['endings']>[FormEndingState]>;

/**
 * One end state's copy editor (Batch 6): an icon Select plus heading/body
 * inputs. Every field is optional — a blank field falls back to the SDK's
 * built-in text — and the whole panel is composed here, then handed up so the
 * reducer merges it into the endings object.
 */
function EndingStateEditor({
  state,
  panel,
  onChange,
}: {
  state: FormEndingState;
  panel: EndingPanel | undefined;
  onChange: (panel: EndingPanel) => void;
}) {
  const set = (p: Partial<EndingPanel>) => onChange({ ...panel, ...p });
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        paddingTop: 8,
        borderTop: '1px solid var(--admin-border, #ececec)',
      }}
    >
      <Typography.Text strong style={{ fontSize: 13 }}>
        {ENDING_STATE_LABELS[state]}
      </Typography.Text>
      <Row label="Icon">
        <Select
          aria-label={`${ENDING_STATE_LABELS[state]} icon`}
          style={{ width: '100%' }}
          allowClear
          placeholder="Default"
          value={panel?.icon}
          onChange={(value) => set({ icon: value as EndingPanel['icon'] })}
          options={FORM_ENDING_ICONS.map((i) => ({ value: i, label: ENDING_ICON_LABELS[i] }))}
        />
      </Row>
      <Row label="Heading">
        <Input
          aria-label={`${ENDING_STATE_LABELS[state]} heading`}
          placeholder="Optional heading"
          value={panel?.heading ?? ''}
          style={{ width: '100%' }}
          onChange={(e) => set({ heading: e.target.value || undefined })}
        />
      </Row>
      <Row label="Message">
        <Input
          aria-label={`${ENDING_STATE_LABELS[state]} message`}
          placeholder="Optional message"
          value={panel?.body ?? ''}
          style={{ width: '100%' }}
          onChange={(e) => set({ body: e.target.value || undefined })}
        />
      </Row>
    </div>
  );
}

/**
 * A compact mini form thumbnail so each preset communicates its look at a
 * glance: a fake heading, input and button styled with the preset's colours,
 * radius and button shape. Decorative — the accessible label lives on the
 * wrapping button.
 */
function PresetThumbnail({ id, appearance }: { id: string; appearance: FormAppearance }) {
  const { colors, layout } = appearance;
  const cardRadius = Math.min(layout.radius, 10);
  const inputRadius = Math.min(layout.radius, 6);
  const buttonRadius =
    layout.buttonShape === 'sharp'
      ? 0
      : layout.buttonShape === 'pill'
        ? 999
        : Math.min(layout.radius, 10);

  return (
    <span
      aria-hidden
      data-testid={`preset-thumb-${id}`}
      style={{
        display: 'block',
        width: 96,
        height: 64,
        borderRadius: 6,
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: 8,
        background: pageBackgroundCss(appearance),
      }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: 6,
          borderRadius: cardRadius,
          boxSizing: 'border-box',
          background: colors.background,
          border: layout.cardBorder ? `1px solid ${colors.border}` : 'none',
        }}
      >
        {/* heading */}
        <span style={{ height: 5, width: '70%', borderRadius: 2, background: colors.text }} />
        {/* input */}
        <span
          style={{
            height: 8,
            borderRadius: inputRadius,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
          }}
        />
        {/* button */}
        <span
          style={{
            height: 10,
            borderRadius: buttonRadius,
            background: colors.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{ height: 3, width: '40%', borderRadius: 2, background: colors.buttonText }}
          />
        </span>
      </span>
    </span>
  );
}

/** Page backdrop behind a preset's mini card — its gradient when set, else the flat page colour. */
function pageBackgroundCss(appearance: FormAppearance): string {
  const { colors, background } = appearance;
  if (background.type === 'gradient' && background.gradientFrom && background.gradientTo) {
    return `linear-gradient(${background.gradientDir ?? 'to bottom'}, ${background.gradientFrom}, ${background.gradientTo})`;
  }
  return colors.pageBackground;
}

function AssetInput({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (url: string) => void;
}) {
  return (
    <Row label={label}>
      <Input
        aria-label={ariaLabel}
        placeholder="https://cdn.example.com/logo.png"
        value={value}
        style={{ width: 220 }}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    </Row>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  // Stack label above the control: side-by-side squeezed long labels into a
  // one-char-per-line column and left segmented controls no room. Stacking gives
  // both the label and the control the full panel width.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Typography.Text style={{ fontSize: 13 }}>{label}</Typography.Text>
      <div style={{ width: '100%' }}>{children}</div>
    </div>
  );
}

/** Effective background for a pair, honouring scrim/gradient; note when it's an image. */
function resolvePairBg(
  pair: ContrastPair,
  appearance: FormAppearance,
): { bg: string; note?: string } {
  const { colors, background } = appearance;
  if (!pair.pageAware || background.type === 'solid') {
    const base = colors[pair.bg];
    if (pair.pageAware && background.scrim > 0) return { bg: scrimmed(base, background.scrim) };
    return { bg: base };
  }
  if (background.type === 'image') {
    return {
      bg: colors[pair.bg],
      note: 'Depends on your background image. A scrim of 0.35+ keeps text readable.',
    };
  }
  // gradient: measure the worse (lower-contrast) of the two scrim-composited stops.
  const s = background.scrim;
  const stopBg = (hex: string) => (s > 0 ? scrimmed(hex, s) : hex);
  const from = stopBg(background.gradientFrom ?? colors.pageBackground);
  const to = stopBg(background.gradientTo ?? colors.pageBackground);
  const fromR = gradeContrast(colors[pair.fg], from).ratio ?? Number.POSITIVE_INFINITY;
  const toR = gradeContrast(colors[pair.fg], to).ratio ?? Number.POSITIVE_INFINITY;
  return { bg: fromR <= toR ? from : to };
}

/** Advisory accessibility report (THEMING-SPEC §5): warns, never blocks; offers a one-click fix. */
function ContrastReport({
  appearance,
  patch,
}: {
  appearance: FormAppearance;
  patch: (p: AppearancePatch) => void;
}) {
  const { colors } = appearance;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <Typography.Text
        strong
        style={{ fontSize: 13 }}
        title="About 1 in 12 people have low vision or colour-blindness. Higher contrast keeps your form readable for everyone. These checks never block saving."
      >
        Accessibility
      </Typography.Text>
      {CONTRAST_PAIRS.map((pair) => {
        const fg = colors[pair.fg];
        const { bg, note } = resolvePairBg(pair, appearance);
        const grade = gradeContrast(fg, bg, { nonText: pair.kind === 'nonText' });
        const st = CONTRAST_STATE[grade.state];
        const canFix = pair.kind === 'text' && grade.state !== 'good' && pair.fix !== undefined;
        return (
          <div
            key={`${pair.fg}-${pair.bg}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto',
                  width: 30,
                  height: 20,
                  borderRadius: 4,
                  background: bg,
                  color: fg,
                  border:
                    pair.kind === 'nonText' ? `2px solid ${fg}` : `1px solid ${colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {pair.kind === 'text' ? 'Aa' : ''}
              </span>
              <span style={{ fontSize: 12, flex: 1 }}>{pair.label}</span>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--admin-text-muted, #5f6368)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {grade.ratio === null ? 'n/a' : `${grade.ratio.toFixed(2)}:1`}
              </span>
            </div>
            <div
              data-testid={`contrast-${pair.fg}-${pair.bg}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 38,
                fontSize: 12,
              }}
            >
              <span aria-hidden style={{ color: st.color }}>
                {st.glyph}
              </span>
              <span style={{ color: st.color }}>{st.word}</span>
              {grade.chip && (
                <Tag
                  bordered={false}
                  style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', padding: '0 6px' }}
                >
                  {grade.chip}
                </Tag>
              )}
              {canFix && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  onClick={() => pair.fix && patch({ colors: { [pair.fix]: bestTextOn(bg) } })}
                >
                  Fix
                </Button>
              )}
            </div>
            {note && (
              <span
                style={{ paddingLeft: 38, fontSize: 11, color: 'var(--admin-text-muted, #5f6368)' }}
              >
                {note}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
