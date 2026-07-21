import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Button,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  Typography,
} from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import { type Dispatch, useState } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { FIELD_TYPE_LABELS } from '@/lib/builder-state';

/**
 * One canvas row (B3). Clicking anywhere on the row selects the field for
 * editing; a hover state plus a pencil affordance signpost that, and a filled
 * drag handle makes reordering obvious.
 */
export function CanvasField({
  field,
  selected,
  dispatch,
}: {
  field: FormField;
  selected: boolean;
  dispatch: Dispatch<BuilderAction>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: field.key,
  });
  const [hovered, setHovered] = useState(false);
  // Content blocks (§1.3) carry no label/required; fall back to the type name.
  const displayLabel = 'label' in field ? field.label : FIELD_TYPE_LABELS[field.type];
  const required = 'required' in field ? field.required : false;
  const active = selected || hovered;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: selection also works via the settings panel
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas row click is a pointer affordance; keyboard users select via the settings panel
    <div
      ref={setNodeRef}
      data-testid={`canvas-field-${field.key}`}
      onClick={() => dispatch({ type: 'selectField', key: field.key })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        border: selected ? '1px solid #1677ff' : '1px solid #e5e5e5',
        borderRadius: 6,
        background: selected ? '#f0f7ff' : active ? '#fafafa' : '#fff',
        boxShadow: active && !selected ? '0 1px 4px rgba(0, 0, 0, 0.08)' : 'none',
        cursor: 'pointer',
      }}
    >
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: dnd-kit's spread attributes include role="button" */}
      <span
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${displayLabel}`}
        style={{
          cursor: 'grab',
          color: '#8c8c8c',
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 4px',
          borderRadius: 4,
          background: active ? '#f0f0f0' : 'transparent',
        }}
      >
        <HolderOutlined />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text strong style={{ display: 'block' }}>
          {displayLabel}
          {required && <span style={{ color: '#cf1322' }}> *</span>}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {FIELD_TYPE_LABELS[field.type]} ({field.key})
        </Typography.Text>
      </div>
      <Button
        type="text"
        size="small"
        aria-label={`Edit ${displayLabel}`}
        icon={<EditOutlined />}
        style={{ opacity: active ? 1 : 0.35 }}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'selectField', key: field.key });
        }}
      />
      <Button
        type="text"
        size="small"
        danger
        aria-label={`Delete ${displayLabel}`}
        icon={<DeleteOutlined />}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'removeField', key: field.key });
        }}
      />
    </div>
  );
}
