import { Button, Divider, Input, Space } from '@primathonos/orion';
import { type FormOption, MAX_OPTIONS } from '@shared/schemas/fields/_shared/base';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
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
  const setOptions = (options: FormOption[]) =>
    dispatch({ type: 'updateField', key: field.key, patch: { options } });
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
              <div style={{ display: 'flex', gap: 4 }}>
                <Input
                  aria-label={`Option ${index + 1} label`}
                  placeholder="Label"
                  value={option.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    const next = [...field.options];
                    const current = next[index];
                    if (current === undefined) return;
                    const taken = new Set(
                      field.options.filter((_, i) => i !== index).map((o) => o.value),
                    );
                    // Track the label while the value is still auto-managed — empty, or
                    // still equal to the prior label's slug. Once the merchant hand-edits
                    // the value it diverges and stops tracking.
                    const autoManaged =
                      current.value === '' || current.value === slugifyValue(current.label);
                    const value = autoManaged ? derivedValue(label, taken) : current.value;
                    next[index] = { value, label };
                    setOptions(next);
                  }}
                />
                <Input
                  aria-label={`Option ${index + 1} value`}
                  placeholder="Value"
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
                <Button
                  size="small"
                  aria-label={`Move option ${index + 1} up`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="small"
                  aria-label={`Move option ${index + 1} down`}
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
    </>
  );
}
