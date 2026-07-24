import { Button, Divider, Input, Space } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { Dispatch } from 'react';
import type { BuilderAction } from '@/lib/builder-state';

/** Shared options list editor — reused by dropdown, multi_select, and radio. */
export function OptionsEditor({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'dropdown' | 'multi_select' | 'radio' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const setOptions = (options: string[]) =>
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
          // biome-ignore lint/suspicious/noArrayIndexKey: options are editable strings, index is the identity
          <div key={index} style={{ display: 'flex', gap: 4 }}>
            <Input
              aria-label={`Option ${index + 1}`}
              value={option}
              onChange={(e) => {
                const next = [...field.options];
                next[index] = e.target.value;
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
          onClick={() => setOptions([...field.options, `Option ${field.options.length + 1}`])}
        >
          Add option
        </Button>
      </Space>
    </>
  );
}
