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
import { type Dispatch, type PointerEvent as ReactPointerEvent, useState } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { FIELD_TYPE_LABELS } from '@/lib/builder-state';
import { isPaletteId } from '@/lib/dnd';

/**
 * One canvas row (B3). The WHOLE row is draggable to reorder (dnd-kit's
 * PointerSensor has `activationConstraint.distance:4`, so a click with no
 * movement never starts a drag and still fires `onClick` to select the field).
 * The ⠿ handle stays as a visible affordance, and the row cursor is `grab`. A
 * 2px accent top-border marks the row a dragged item will land above, and the
 * item being dragged gets a subtle "lifted" look.
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
  const {
    active: activeDrag,
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    isSorting,
  } = useSortable({
    id: field.key,
  });
  const [hovered, setHovered] = useState(false);
  // Content blocks (§1.3) carry no label/required; fall back to the type name.
  const displayLabel = 'label' in field ? field.label : FIELD_TYPE_LABELS[field.type];
  const required = 'required' in field ? field.required : false;
  const active = selected || hovered;
  // Drop indicator: a 2px top-border marking where a NEW palette field will land.
  // Reorders of existing rows shift the list live, which is its own feedback, so
  // the static border would be redundant there — show it only for palette drags.
  const draggingFromPalette = activeDrag ? isPaletteId(String(activeDrag.id)) : false;
  const showDropIndicator = isOver && !isDragging && draggingFromPalette;
  // Stop a pointer-down on the action buttons from reaching the row's drag
  // listeners, so pressing Edit/Delete never starts a drag (their onClick +
  // stopPropagation keep selection/removal working).
  const stopDrag = (e: ReactPointerEvent) => e.stopPropagation();
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: selection also works via the settings panel
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas row click is a pointer affordance; keyboard users select via the settings panel
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
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
        borderTop: showDropIndicator ? '2px solid #1677ff' : undefined,
        borderRadius: 6,
        background: selected ? '#f0f7ff' : active ? '#fafafa' : '#fff',
        boxShadow: isDragging
          ? '0 6px 16px rgba(0, 0, 0, 0.18)'
          : active && !selected
            ? '0 1px 4px rgba(0, 0, 0, 0.08)'
            : 'none',
        opacity: isDragging ? 0.6 : 1,
        // A grab cursor signposts the whole row is draggable; the constraint
        // still lets a plain click select without starting a drag.
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        // Lift the dragged row above its neighbours while sorting.
        zIndex: isDragging ? 1 : undefined,
        position: isSorting || isDragging ? 'relative' : undefined,
      }}
    >
      <span
        aria-hidden
        style={{
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
        style={{ opacity: active ? 1 : 0.35, cursor: 'pointer' }}
        onPointerDown={stopDrag}
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
        style={{ cursor: 'pointer' }}
        onPointerDown={stopDrag}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'removeField', key: field.key });
        }}
      />
    </div>
  );
}
