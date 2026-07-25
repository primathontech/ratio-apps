import { Button, Divider, Input, Space } from '@primathonos/orion';
import type { FormOption } from '@shared/schemas/fields/_shared/base';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';

/**
 * Derive a machine-safe option value from its label: lowercase, spaces→hyphens,
 * strip anything outside [a-z0-9-]. Used to seed `value` while the merchant has
 * not hand-edited it, so a fresh label yields a sensible stored value.
 */
function slugifyValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
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
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Options</Divider>
      <Space direction="vertical" size={8} style={{ display: 'flex' }}>
        {field.options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: options are editable rows, index is the identity
          <div key={index} style={{ display: 'flex', gap: 4 }}>
            <Input
              aria-label={`Option ${index + 1} label`}
              placeholder="Label"
              value={option.label}
              onChange={(e) => {
                const label = e.target.value;
                const next = [...field.options];
                const current = next[index];
                if (current === undefined) return;
                // Auto-derive the value from the label while the value is still
                // empty; once the merchant types a value it sticks.
                const value = current.value === '' ? slugifyValue(label) : current.value;
                next[index] = { value, label };
                setOptions(next);
              }}
            />
            <Input
              aria-label={`Option ${index + 1} value`}
              placeholder="Value"
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
        ))}
        <Button
          size="small"
          onClick={() => {
            const n = field.options.length + 1;
            setOptions([...field.options, { value: `option-${n}`, label: `Option ${n}` }]);
          }}
        >
          Add option
        </Button>
      </Space>
    </>
  );
}
