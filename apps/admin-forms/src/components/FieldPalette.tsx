import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  AlignLeftOutlined,
  CalendarOutlined,
  Card,
  CheckCircleOutlined,
  CheckSquareOutlined,
  DownSquareOutlined,
  EyeInvisibleOutlined,
  FieldNumberOutlined,
  FileTextOutlined,
  FontColorsOutlined,
  FontSizeOutlined,
  LineOutlined,
  LinkOutlined,
  MailOutlined,
  PaperClipOutlined,
  PhoneOutlined,
  PictureOutlined,
  StarOutlined,
  Typography,
  UnorderedListOutlined,
} from '@primathonos/orion';
import type { FormFieldType } from '@shared/schemas/form-schema';
import { type Dispatch, type ReactNode, useMemo } from 'react';
import type { BuilderAction } from '@/lib/builder-state';
import { FIELD_TYPE_LABELS } from '@/lib/builder-state';
// PALETTE_PREFIX now lives with the rest of the dnd wiring; re-exported here so
// existing importers keep working.
import { PALETTE_PREFIX } from '@/lib/dnd';

export { PALETTE_PREFIX };

/** A small glyph per field type so the palette scans by shape, not just text. */
const FIELD_TYPE_ICONS: Record<FormFieldType, ReactNode> = {
  text: <FontSizeOutlined />,
  textarea: <AlignLeftOutlined />,
  email: <MailOutlined />,
  phone: <PhoneOutlined />,
  dropdown: <DownSquareOutlined />,
  multi_select: <UnorderedListOutlined />,
  date: <CalendarOutlined />,
  file: <PaperClipOutlined />,
  radio: <CheckCircleOutlined />,
  checkbox: <CheckSquareOutlined />,
  number: <FieldNumberOutlined />,
  url: <LinkOutlined />,
  rating: <StarOutlined />,
  hidden: <EyeInvisibleOutlined />,
  heading: <FontColorsOutlined />,
  divider: <LineOutlined />,
  paragraph: <FileTextOutlined />,
  image: <PictureOutlined />,
};

/**
 * Palette sections (B1). Inputs collect data; layout blocks are the §1.3
 * display-only content blocks. Both render as a compact 2-column grid so the
 * full type set is scannable without a long vertical scroll.
 */
const PALETTE_GROUPS: { title: string; types: FormFieldType[] }[] = [
  {
    title: 'Input fields',
    types: [
      'text',
      'textarea',
      'email',
      'phone',
      'dropdown',
      'multi_select',
      'date',
      'file',
      'radio',
      'checkbox',
      'number',
      'url',
      'rating',
      'hidden',
    ],
  },
  {
    title: 'Layout blocks',
    types: ['heading', 'divider', 'paragraph', 'image'],
  },
];

export function FieldPalette({ dispatch }: { dispatch: Dispatch<BuilderAction> }) {
  return (
    <Card title="Fields" style={{ flex: '0 0 240px' }} styles={{ body: { padding: 12 } }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {PALETTE_GROUPS.map((group) => (
          <div key={group.title}>
            <Typography.Text
              type="secondary"
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                marginBottom: 8,
              }}
            >
              {group.title}
            </Typography.Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
              }}
            >
              {group.types.map((fieldType) => (
                <PaletteItem key={fieldType} fieldType={fieldType} dispatch={dispatch} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PaletteItem({
  fieldType,
  dispatch,
}: {
  fieldType: FormFieldType;
  dispatch: Dispatch<BuilderAction>;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `${PALETTE_PREFIX}${fieldType}`,
  });
  // Memoize so the drag transform is the only thing that changes per render.
  const style = useMemo(
    () => ({
      transform: CSS.Translate.toString(transform),
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      textAlign: 'left' as const,
      padding: '8px 10px',
      border: '1px solid #e5e5e5',
      borderRadius: 6,
      background: '#fff',
      cursor: 'grab',
      fontSize: 12,
      lineHeight: 1.25,
      minWidth: 0,
    }),
    [transform],
  );
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => dispatch({ type: 'addField', fieldType })}
      style={style}
    >
      <span aria-hidden style={{ color: '#8c8c8c', display: 'inline-flex', flex: '0 0 auto' }}>
        {FIELD_TYPE_ICONS[fieldType]}
      </span>
      <span
        // Wrap to two lines instead of truncating so every type name stays
        // fully readable in the narrow palette cell (B7).
        style={{
          minWidth: 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          wordBreak: 'break-word',
        }}
      >
        {FIELD_TYPE_LABELS[fieldType]}
      </span>
    </button>
  );
}
