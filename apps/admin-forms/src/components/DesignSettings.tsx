import {
  Card,
  Collapse,
  ColorPicker,
  Input,
  Segmented,
  Select,
  Slider,
  Switch,
  Typography,
} from '@primathonos/orion';
import {
  FORM_BG_IMAGE_FITS,
  FORM_BG_TYPES,
  FORM_BUTTON_ALIGNMENTS,
  FORM_BUTTON_ICONS,
  FORM_BUTTON_SHAPES,
  FORM_BUTTON_SIZES,
  FORM_COLUMN_MODES,
  FORM_DENSITIES,
  FORM_FOCUS_STYLES,
  FORM_FONT_FAMILIES,
  FORM_GRADIENT_DIRS,
  FORM_INPUT_VARIANTS,
  FORM_LABEL_POSITIONS,
  FORM_REQUIRED_MARKS,
  FORM_SHADOWS,
  type FormAppearance,
} from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { AppearancePatch, BuilderAction } from '@/lib/builder-state';
import { contrastRatio } from '@/lib/contrast';
import { type AppearancePreset, FORM_APPEARANCE_PRESETS } from '@/lib/presets';

/** Color tokens, in edit order, with the label shown next to each picker. */
const COLOR_TOKENS: { key: keyof FormAppearance['colors']; label: string }[] = [
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

/** Column-mode labels (§2.1) — 'auto' collapses on narrow embeds. */
const COLUMN_MODE_LABELS: Record<(typeof FORM_COLUMN_MODES)[number], string> = {
  '1': '1',
  '2': '2',
  auto: 'Auto',
};

/** Pairs worth checking, with their WCAG threshold. */
const CONTRAST_PAIRS: {
  fg: keyof FormAppearance['colors'];
  bg: keyof FormAppearance['colors'];
  label: string;
  threshold: number;
}[] = [
  { fg: 'text', bg: 'background', label: 'Text on background', threshold: 4.5 },
  { fg: 'text', bg: 'pageBackground', label: 'Text on page', threshold: 4.5 },
  { fg: 'text', bg: 'surface', label: 'Text on surface', threshold: 4.5 },
  { fg: 'muted', bg: 'background', label: 'Muted on background', threshold: 4.5 },
  { fg: 'buttonText', bg: 'primary', label: 'Button text on primary', threshold: 4.5 },
  { fg: 'border', bg: 'background', label: 'Border on background', threshold: 3 },
];

interface Props {
  /** Resolved appearance (defaults filled) — never partial. */
  appearance: FormAppearance;
  dispatch: Dispatch<BuilderAction>;
}

/** The right-panel "Design" tab: colours, typography and layout controls. */
export function DesignSettings({ appearance, dispatch }: Props) {
  const patch = (p: AppearancePatch) => dispatch({ type: 'updateAppearance', patch: p });
  const { colors, typography, layout, background } = appearance;

  // A preset swaps colors/typography/layout/background wholesale; logo/cover
  // are left as-is.
  const applyPreset = (p: AppearancePreset) =>
    patch({
      colors: p.appearance.colors,
      typography: p.appearance.typography,
      layout: p.appearance.layout,
      background: p.appearance.background,
    });

  return (
    <Card title="Design">
      <PresetRow onApply={applyPreset} />
      <Collapse
        defaultActiveKey={['colors', 'typography', 'layout', 'inputs', 'buttons', 'background']}
        items={[
          {
            key: 'colors',
            label: 'Colors',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {COLOR_TOKENS.map(({ key, label }) => (
                  <Row key={key} label={label}>
                    <ColorPicker
                      aria-label={`${label} color`}
                      value={colors[key]}
                      format="hex"
                      showText
                      onChangeComplete={(c) => patch({ colors: { [key]: c.toHexString() } })}
                    />
                  </Row>
                ))}
                <ContrastReport colors={colors} />
              </div>
            ),
          },
          {
            key: 'typography',
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
              </div>
            ),
          },
          {
            key: 'layout',
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
                <Row label={`Max width (${layout.maxWidth}px)`}>
                  <Slider
                    aria-label="Max width"
                    min={280}
                    max={960}
                    step={10}
                    value={layout.maxWidth}
                    onChange={(value) => patch({ layout: { maxWidth: value as number } })}
                  />
                </Row>
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
              </div>
            ),
          },
          {
            key: 'inputs',
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
            label: 'Buttons',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
            key: 'background',
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
            label: 'Brand assets',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <AssetInput
                  label="Logo URL (https)"
                  ariaLabel="Logo URL"
                  value={appearance.logo?.url ?? ''}
                  onChange={(url) => patch({ logo: url ? { url } : undefined })}
                />
                <AssetInput
                  label="Cover image URL (https)"
                  ariaLabel="Cover URL"
                  value={appearance.cover?.url ?? ''}
                  onChange={(url) => patch({ cover: url ? { url } : undefined })}
                />
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}

function PresetRow({ onApply }: { onApply: (preset: AppearancePreset) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
        Presets
      </Typography.Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {FORM_APPEARANCE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-label={`Apply ${preset.name} preset`}
            onClick={() => onApply(preset)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'flex', gap: 4 }}>
              {(['primary', 'background', 'text'] as const).map((token) => (
                <span
                  key={token}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: preset.appearance.colors[token],
                    border: '1px solid #d9d9d9',
                  }}
                />
              ))}
            </span>
            <span style={{ fontSize: 12 }}>{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
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
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
    >
      <Typography.Text style={{ fontSize: 13 }}>{label}</Typography.Text>
      <div>{children}</div>
    </div>
  );
}

function ContrastReport({ colors }: { colors: FormAppearance['colors'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      <Typography.Text strong style={{ fontSize: 13 }}>
        Contrast (WCAG)
      </Typography.Text>
      {CONTRAST_PAIRS.map((pair) => {
        const ratio = contrastRatio(colors[pair.fg], colors[pair.bg]);
        const pass = ratio !== null && ratio >= pair.threshold;
        return (
          <div
            key={pair.label}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}
          >
            <span>{pair.label}</span>
            <span
              data-testid={`contrast-${pair.fg}-${pair.bg}`}
              style={{ color: pass ? '#067647' : '#c0392b', fontWeight: 600 }}
            >
              {ratio === null ? 'n/a' : `${ratio.toFixed(2)}:1`} {pass ? 'AA' : 'fail'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
