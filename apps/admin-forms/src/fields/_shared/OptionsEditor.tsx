import { Button, Divider, Input, Space, Switch, Typography } from '@primathonos/orion';
import { type FormOption, MAX_OPTIONS } from '@shared/schemas/fields/_shared/base';
import type { FormField } from '@shared/schemas/form-schema';
import { type Dispatch, useState } from 'react';
import type { BuilderAction } from '@/lib/builder-state';

/**
 * Slugify a label into a machine-safe option value. May return '' for a label
 * with no ASCII alphanumerics (non-Latin/emoji) — callers handle that.
 */
function slugifyValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** First `option-N` (N ≥ 1) whose value isn't already `taken`. */
function nextAutoValue(taken: Set<string>): string {
  let n = 1;
  while (taken.has(`option-${n}`)) n += 1;
  return `option-${n}`;
}

/**
 * The value to store for a row whose label changed while its value was still
 * auto-managed: the slug of the label, de-duped against sibling values. Falls
 * back to a fresh `option-N` when the label slugifies to '' (non-Latin/emoji),
 * so the auto-derived value is never empty or a duplicate — both of which the
 * shared schema rejects at publish.
 */
function derivedValue(label: string, taken: Set<string>): string {
  const slug = slugifyValue(label);
  if (!slug) return nextAutoValue(taken);
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

/** Shared options list editor — reused by dropdown, multi_select, and radio. */
export function OptionsEditor({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'dropdown' | 'multi_select' | 'radio' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const isMulti = field.type === 'multi_select';
  const [pasteText, setPasteText] = useState('');

  // Drop any defaultValue that no longer points at an existing option, so a
  // removed/renamed option can't leave a dangling default the schema rejects
  // at publish. Returns the patch fragment (or {} when nothing changed).
  const prunedDefault = (options: FormOption[]): Partial<FormField> => {
    const values = new Set(options.map((o) => o.value));
    if (field.type === 'multi_select') {
      const current = field.defaultValue ?? [];
      const next = current.filter((v) => values.has(v));
      if (next.length === current.length) return {};
      return { defaultValue: next.length > 0 ? next : undefined };
    }
    if (field.defaultValue !== undefined && !values.has(field.defaultValue)) {
      return { defaultValue: undefined };
    }
    return {};
  };

  const setOptions = (options: FormOption[]) =>
    dispatch({
      type: 'updateField',
      key: field.key,
      patch: { options, ...prunedDefault(options) },
    });

  // Default-option marker: single-choice (dropdown/radio) stores one value;
  // multi_select stores a subset array.
  const isDefault = (value: string): boolean =>
    field.type === 'multi_select'
      ? (field.defaultValue ?? []).includes(value)
      : field.defaultValue === value;
  const toggleDefault = (value: string) => {
    if (field.type === 'multi_select') {
      const current = field.defaultValue ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      dispatch({
        type: 'updateField',
        key: field.key,
        patch: { defaultValue: next.length > 0 ? next : undefined },
      });
    } else {
      dispatch({
        type: 'updateField',
        key: field.key,
        patch: { defaultValue: field.defaultValue === value ? undefined : value },
      });
    }
  };

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= field.options.length) return;
    const next = [...field.options];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    setOptions(next);
  };

  // Surface the schema's value rules (non-empty + unique) inline, so the
  // merchant sees the problem while editing rather than only at publish.
  const valueCounts = field.options.reduce<Record<string, number>>((counts, o) => {
    counts[o.value] = (counts[o.value] ?? 0) + 1;
    return counts;
  }, {});
  const valueError = (value: string): string | null => {
    if (value.trim() === '') return 'Value cannot be empty';
    if ((valueCounts[value] ?? 0) > 1) return 'Duplicate value';
    return null;
  };

  const atMax = field.options.length >= MAX_OPTIONS;

  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Options</Divider>
      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
        {field.options.map((option, index) => {
          const error = valueError(option.value);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: options are editable rows, index is the identity
            <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Label and value each take a full line so both render completely
                  in the narrow settings panel; the row controls sit on their own
                  line below rather than stealing input width. */}
              <Input
                aria-label={`Option ${index + 1} label`}
                placeholder="Label"
                style={{ width: '100%' }}
                value={option.label}
                onChange={(e) => {
                  const label = e.target.value;
                  const next = [...field.options];
                  const current = next[index];
                  if (current === undefined) return;
                  const taken = new Set(
                    field.options.filter((_, i) => i !== index).map((o) => o.value),
                  );
                  // Track the label while the value is still auto-managed —
                  // empty, or still mirroring the prior label (as its slug, or
                  // verbatim, e.g. a value seeded as "Morning" from the label).
                  // Once the merchant hand-edits the value it diverges and stops.
                  const autoManaged =
                    current.value === '' ||
                    current.value === slugifyValue(current.label) ||
                    current.value === current.label;
                  const value = autoManaged ? derivedValue(label, taken) : current.value;
                  next[index] = { value, label };
                  setOptions(next);
                }}
              />
              <Input
                aria-label={`Option ${index + 1} value`}
                addonBefore="Value"
                size="small"
                style={{ width: '100%' }}
                placeholder="export value"
                {...(error ? { status: 'error' as const } : {})}
                value={option.value}
                onChange={(e) => {
                  const next = [...field.options];
                  const current = next[index];
                  if (current === undefined) return;
                  next[index] = { ...current, value: e.target.value };
                  setOptions(next);
                }}
              />
              {/* Row controls (default / reorder / remove) on their own
                  right-aligned line. */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                <Button
                  size="small"
                  {...(isDefault(option.value) ? { type: 'primary' as const } : {})}
                  aria-label={`${isDefault(option.value) ? 'Unset' : 'Set'} option ${index + 1} as default`}
                  aria-pressed={isDefault(option.value)}
                  title={isDefault(option.value) ? 'Default selection' : 'Set as default'}
                  onClick={() => toggleDefault(option.value)}
                >
                  {isDefault(option.value) ? '★' : '☆'}
                </Button>
                <Button
                  size="small"
                  aria-label={`Move option ${index + 1} up`}
                  // First row can't move up — disable so the dead control is obvious.
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="small"
                  aria-label={`Move option ${index + 1} down`}
                  // Last row can't move down.
                  disabled={index === field.options.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="small"
                  danger
                  aria-label={`Remove option ${index + 1}`}
                  disabled={field.options.length <= 1}
                  onClick={() => setOptions(field.options.filter((_, i) => i !== index))}
                >
                  ✕
                </Button>
              </div>
              {error && (
                <span role="alert" style={{ color: 'var(--color-error, #d4380d)', fontSize: 12 }}>
                  {error}
                </span>
              )}
            </div>
          );
        })}
        <Button
          size="small"
          disabled={atMax}
          title={atMax ? `Maximum ${MAX_OPTIONS} options` : undefined}
          onClick={() => {
            if (atMax) return;
            const value = nextAutoValue(new Set(field.options.map((o) => o.value)));
            const n = value.replace('option-', '');
            setOptions([...field.options, { value, label: `Option ${n}` }]);
          }}
        >
          Add option
        </Button>
      </Space>

      <Divider style={{ margin: '8px 0 4px' }}>Bulk add</Divider>
      <Input.TextArea
        aria-label="Paste options"
        rows={3}
        placeholder="Paste one option per line (or comma-separated)"
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
      />
      <Button
        size="small"
        style={{ marginTop: 4 }}
        disabled={atMax || pasteText.trim() === ''}
        title={atMax ? `Maximum ${MAX_OPTIONS} options` : undefined}
        onClick={() => {
          const labels = pasteText
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter((s) => s !== '');
          if (labels.length === 0) return;
          const taken = new Set(field.options.map((o) => o.value));
          const additions: FormOption[] = [];
          for (const label of labels) {
            if (field.options.length + additions.length >= MAX_OPTIONS) break;
            const value = derivedValue(label, taken);
            taken.add(value);
            additions.push({ value, label });
          }
          if (additions.length > 0) setOptions([...field.options, ...additions]);
          setPasteText('');
        }}
      >
        Add from text
      </Button>

      <Divider style={{ margin: '8px 0 4px' }}>Other</Divider>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          aria-label={'Allow "Other" free-text choice'}
          checked={field.allowOther === true}
          onChange={(checked) =>
            dispatch({
              type: 'updateField',
              key: field.key,
              patch: { allowOther: checked || undefined },
            })
          }
        />
        <Typography.Text>
          Add an &ldquo;Other&rdquo; choice with a free-text {isMulti ? 'entry' : 'input'}
        </Typography.Text>
      </div>
      {field.allowOther === true && (
        <div style={{ marginTop: 8 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
            &ldquo;Other&rdquo; label
          </Typography.Text>
          <Input
            aria-label="Other label"
            maxLength={60}
            placeholder="Other"
            value={field.otherLabel ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'updateField',
                key: field.key,
                patch: { otherLabel: e.target.value || undefined },
              })
            }
          />
        </div>
      )}
    </>
  );
}
