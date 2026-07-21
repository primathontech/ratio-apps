import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Alert,
  ArrowLeftOutlined,
  Button,
  Card,
  Checkbox,
  Collapse,
  ColorPicker,
  DeleteOutlined,
  Divider,
  HolderOutlined,
  Input,
  message,
  PrimaryButton,
  Radio,
  RadioGroup,
  Segmented,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from '@primathonos/orion';
import {
  FORM_FIELD_TYPES,
  FORM_FIELD_WIDTHS,
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_HEADING_LEVELS,
  FORM_INPUT_VARIANTS,
  FORM_RATING_ICONS,
  FORM_TEXTAREA_HARD_MAX_LENGTH,
  type FormField,
  type FormFieldType,
  formInputSchema,
  isAdornable,
  isCollectableFieldType,
  supportsCounter,
} from '@shared/schemas/form-schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { type Dispatch, useEffect, useReducer, useState } from 'react';
import { DesignSettings } from '@/components/DesignSettings';
import { FormPreview } from '@/components/FormPreview';
import { useForm, useToggleFormStatus, useUpdateForm } from '@/hooks/useForms';
import { useWebhookTest } from '@/hooks/useWebhookTest';
import {
  type BuilderAction,
  type BuilderState,
  builderReducer,
  DEFAULT_APPEARANCE,
  EMPTY_BUILDER_STATE,
  FIELD_TYPE_LABELS,
  toFormInput,
} from '@/lib/builder-state';

export const Route = createFileRoute('/builder/$formId')({
  component: BuilderRoute,
});

function BuilderRoute() {
  const { formId } = Route.useParams();
  return <BuilderScreen formId={formId} />;
}

const PALETTE_PREFIX = 'palette:';

/** The three-pane form builder (PRD "Form builder", TRD §2, TDD §4). */
export function BuilderScreen({ formId }: { formId: string }) {
  const form = useForm(formId);
  const update = useUpdateForm(formId);
  const toggle = useToggleFormStatus();
  const webhookTest = useWebhookTest(formId);
  const [state, dispatch] = useReducer(builderReducer, EMPTY_BUILDER_STATE);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    // Hydrate the local builder state exactly once per loaded form — later
    // refetches must not clobber unsaved edits.
    if (form.data && loadedFor !== form.data.id) {
      dispatch({ type: 'load', form: form.data });
      setLoadedFor(form.data.id);
    }
  }, [form.data, loadedFor]);

  if (form.isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (form.isError || !form.data) {
    return <Alert type="error" showIcon message="This form could not be loaded." />;
  }

  const status = form.data.status;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);
    if (activeId.startsWith(PALETTE_PREFIX)) {
      const fieldType = activeId.slice(PALETTE_PREFIX.length) as FormFieldType;
      const overKey = over ? String(over.id) : null;
      const index =
        overKey && overKey !== 'builder-canvas'
          ? state.fields.findIndex((f) => f.key === overKey)
          : state.fields.length;
      dispatch({
        type: 'addField',
        fieldType,
        index: index === -1 ? state.fields.length : index,
      });
      return;
    }
    if (!over || active.id === over.id) return;
    const from = state.fields.findIndex((f) => f.key === activeId);
    const to = state.fields.findIndex((f) => f.key === String(over.id));
    if (from !== -1 && to !== -1) dispatch({ type: 'reorderField', from, to });
  };

  const onSave = () => {
    const payload = toFormInput(state);
    const parsed = formInputSchema.safeParse(payload);
    if (!parsed.success) {
      setSaveErrors(
        parsed.error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        ),
      );
      return;
    }
    setSaveErrors([]);
    update.mutate(parsed.data, {
      onSuccess: () => {
        dispatch({ type: 'markSaved' });
        void message.success('Form saved');
      },
    });
  };

  const selected = state.fields.find((f) => f.key === state.selectedKey) ?? null;

  return (
    <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/" aria-label="Back to forms">
          <Button type="text" icon={<ArrowLeftOutlined />} />
        </Link>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {state.meta.name || 'Untitled form'}
          </Typography.Title>
          <Space size={8}>
            <Tag color={status === 'active' ? 'green' : 'default'}>{status}</Tag>
            {state.dirty && <Typography.Text type="secondary">Unsaved changes</Typography.Text>}
          </Space>
        </div>
        <Space wrap>
          <Link to="/submissions/$formId" params={{ formId }}>
            <Button>Submissions</Button>
          </Link>
          <Button onClick={() => setPreviewOpen((v) => !v)}>
            {previewOpen ? 'Close preview' : 'Preview'}
          </Button>
          <Button
            loading={toggle.isPending}
            onClick={() => toggle.mutate({ id: formId, active: status !== 'active' })}
          >
            {status === 'active' ? 'Unpublish' : 'Publish'}
          </Button>
          <PrimaryButton loading={update.isPending} onClick={onSave}>
            Save
          </PrimaryButton>
        </Space>
      </div>

      {saveErrors.length > 0 && (
        <Alert
          type="error"
          showIcon
          message="The form can't be saved yet"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {saveErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          }
        />
      )}
      {update.error && <Alert type="error" showIcon message={(update.error as Error).message} />}

      {previewOpen ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Card title="Mobile (375px)" style={{ flex: '0 0 auto', maxWidth: '100%' }}>
            <FormPreview
              name={state.meta.name}
              fields={state.fields}
              submitLabel={state.meta.submitLabel}
              successMessage={state.meta.successMessage}
              description={state.meta.description}
              appearance={state.meta.appearance}
              mode="mobile"
            />
          </Card>
          <Card title="Desktop" style={{ flex: 1, minWidth: 320 }}>
            <FormPreview
              name={state.meta.name}
              fields={state.fields}
              submitLabel={state.meta.submitLabel}
              successMessage={state.meta.successMessage}
              description={state.meta.description}
              appearance={state.meta.appearance}
              mode="desktop"
            />
          </Card>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <FieldPalette dispatch={dispatch} />
            <Canvas state={state} dispatch={dispatch} />
            <div style={{ flex: '1 1 280px', minWidth: 280 }}>
              {selected ? (
                <FieldSettings field={selected} dispatch={dispatch} />
              ) : (
                <Tabs
                  items={[
                    {
                      key: 'content',
                      label: 'Content',
                      children: (
                        <FormSettings
                          state={state}
                          dispatch={dispatch}
                          onWebhookTest={() =>
                            webhookTest.mutate(undefined, {
                              onSuccess: (result) =>
                                void message.info(
                                  result.statusCode === null
                                    ? 'Webhook test sent, no response (network error)'
                                    : `Webhook responded with status ${result.statusCode}`,
                                ),
                              onError: (err) => void message.error((err as Error).message),
                            })
                          }
                          webhookTestPending={webhookTest.isPending}
                          webhookTestResult={webhookTest.data ?? null}
                        />
                      ),
                    },
                    {
                      key: 'design',
                      label: 'Design',
                      children: (
                        <DesignSettings
                          appearance={state.meta.appearance ?? DEFAULT_APPEARANCE}
                          dispatch={dispatch}
                        />
                      ),
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </DndContext>
      )}
    </Space>
  );
}

function FieldPalette({ dispatch }: { dispatch: Dispatch<BuilderAction> }) {
  return (
    <Card title="Fields" style={{ flex: '0 0 180px' }} styles={{ body: { padding: 12 } }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FORM_FIELD_TYPES.map((fieldType) => (
          <PaletteItem key={fieldType} fieldType={fieldType} dispatch={dispatch} />
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
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => dispatch({ type: 'addField', fieldType })}
      style={{
        transform: CSS.Translate.toString(transform),
        textAlign: 'left',
        padding: '8px 10px',
        border: '1px solid #e5e5e5',
        borderRadius: 6,
        background: '#fff',
        cursor: 'grab',
        fontSize: 13,
      }}
    >
      {FIELD_TYPE_LABELS[fieldType]}
    </button>
  );
}

function Canvas({ state, dispatch }: { state: BuilderState; dispatch: Dispatch<BuilderAction> }) {
  const { setNodeRef } = useDroppable({ id: 'builder-canvas' });
  return (
    <Card title="Form canvas" style={{ flex: '2 1 320px', minWidth: 280 }}>
      <div ref={setNodeRef} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SortableContext
          items={state.fields.map((f) => f.key)}
          strategy={verticalListSortingStrategy}
        >
          {state.fields.length === 0 && (
            <Typography.Text type="secondary">
              Click or drag fields from the palette to add them here.
            </Typography.Text>
          )}
          {state.fields.map((field) => (
            <CanvasField
              key={field.key}
              field={field}
              selected={state.selectedKey === field.key}
              dispatch={dispatch}
            />
          ))}
        </SortableContext>
      </div>
    </Card>
  );
}

function CanvasField({
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
  // Content blocks (§1.3) carry no label/required; fall back to the type name.
  const displayLabel = 'label' in field ? field.label : FIELD_TYPE_LABELS[field.type];
  const required = 'required' in field ? field.required : false;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: selection also works via the settings panel
    // biome-ignore lint/a11y/noStaticElementInteractions: canvas row click is a pointer affordance; keyboard users select via the settings panel
    <div
      ref={setNodeRef}
      data-testid={`canvas-field-${field.key}`}
      onClick={() => dispatch({ type: 'selectField', key: field.key })}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        border: selected ? '1px solid #1677ff' : '1px solid #e5e5e5',
        borderRadius: 6,
        background: selected ? '#f0f7ff' : '#fff',
        cursor: 'pointer',
      }}
    >
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: dnd-kit's spread attributes include role="button" */}
      <span
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${displayLabel}`}
        style={{ cursor: 'grab', color: '#999', display: 'inline-flex' }}
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

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}

/** Segmented labels for the per-field render width. */
const WIDTH_LABELS: Record<(typeof FORM_FIELD_WIDTHS)[number], string> = {
  full: 'Full width',
  half: 'Half width',
};

function FieldSettings({
  field,
  dispatch,
}: {
  field: FormField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<FormField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  // Content blocks (§1.3) are display-only: no label/placeholder/required.
  const collectable = isCollectableFieldType(field.type);
  return (
    <Card
      title={
        collectable
          ? `${FIELD_TYPE_LABELS[field.type]} field`
          : `${FIELD_TYPE_LABELS[field.type]} block`
      }
      extra={
        <Button size="small" onClick={() => dispatch({ type: 'selectField', key: null })}>
          Done
        </Button>
      }
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        {'label' in field && (
          <SettingRow label="Label">
            <Input
              aria-label="Field label"
              value={field.label}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow label="Key">
          <Input
            aria-label="Field key"
            value={field.key}
            onChange={(e) => patch({ key: e.target.value })}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Auto-generated from the label; used in exports and webhooks.
          </Typography.Text>
        </SettingRow>
        {'placeholder' in field && (
          <SettingRow label="Placeholder">
            <Input
              aria-label="Field placeholder"
              value={field.placeholder ?? ''}
              onChange={(e) => patch({ placeholder: e.target.value })}
            />
          </SettingRow>
        )}
        {'required' in field && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Switch
              aria-label="Required"
              checked={field.required}
              onChange={(checked) => patch({ required: checked })}
            />
            <Typography.Text>Required</Typography.Text>
          </div>
        )}
        {field.type !== 'hidden' && (
          <SettingRow label="Width">
            <Segmented
              aria-label="Field width"
              value={field.width ?? 'full'}
              onChange={(value) => patch({ width: value as FormField['width'] })}
              options={FORM_FIELD_WIDTHS.map((w) => ({ value: w, label: WIDTH_LABELS[w] }))}
            />
          </SettingRow>
        )}
        <TypeSpecificSettings field={field} dispatch={dispatch} />
        {/* §2.3 adornments — only when the type supports a chip or a counter. §2.2 style override — any collectable field. */}
        {'required' in field && (isAdornable(field.type) || supportsCounter(field.type)) && (
          <AdornmentSettings field={field} dispatch={dispatch} />
        )}
        {'required' in field && <AdvancedStyleSettings field={field} dispatch={dispatch} />}
      </Space>
    </Card>
  );
}

/** Any field that collects data — the members carrying baseFieldShape's style/adornments. */
type CollectableField = Extract<FormField, { required: boolean }>;

/** §2.3 — per-field prefix/suffix, help text and character counter (all text nodes). */
function AdornmentSettings({
  field,
  dispatch,
}: {
  field: CollectableField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<CollectableField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Adornments</Divider>
      {isAdornable(field.type) && (
        <div style={{ display: 'flex', gap: 8 }}>
          <SettingRow label="Prefix">
            <Input
              aria-label="Prefix"
              maxLength={8}
              placeholder="e.g. $"
              value={field.prefix ?? ''}
              onChange={(e) => patch({ prefix: e.target.value || undefined })}
            />
          </SettingRow>
          <SettingRow label="Suffix">
            <Input
              aria-label="Suffix"
              maxLength={8}
              placeholder="e.g. .com"
              value={field.suffix ?? ''}
              onChange={(e) => patch({ suffix: e.target.value || undefined })}
            />
          </SettingRow>
        </div>
      )}
      <SettingRow label="Help text">
        <Input
          aria-label="Help text"
          maxLength={200}
          placeholder="Shown below the field"
          value={field.helpText ?? ''}
          onChange={(e) => patch({ helpText: e.target.value || undefined })}
        />
      </SettingRow>
      {supportsCounter(field.type) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch
            aria-label="Show character counter"
            checked={field.showCounter ?? false}
            onChange={(checked) => patch({ showCounter: checked })}
          />
          <Typography.Text>Show character counter</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Needs a max length
          </Typography.Text>
        </div>
      )}
    </>
  );
}

/** §2.2 — per-field opt-out of the global input variant/accent. Absent = inherits. */
function AdvancedStyleSettings({
  field,
  dispatch,
}: {
  field: CollectableField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const style = field.style ?? {};
  // Rebuild the whole style object each edit (updateField replaces it), then drop
  // it entirely when nothing is pinned so the field cleanly inherits the global look.
  const setStyle = (next: NonNullable<CollectableField['style']>) => {
    const cleaned: NonNullable<CollectableField['style']> = {};
    if (next.inputVariant !== undefined) cleaned.inputVariant = next.inputVariant;
    if (next.accent !== undefined) cleaned.accent = next.accent;
    dispatch({
      type: 'updateField',
      key: field.key,
      patch: { style: Object.keys(cleaned).length ? cleaned : undefined },
    });
  };
  return (
    <Collapse
      items={[
        {
          key: 'advanced-style',
          label: 'Advanced style',
          children: (
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <SettingRow label="Input style">
                <Segmented
                  aria-label="Field input style"
                  value={style.inputVariant ?? 'inherit'}
                  onChange={(value) =>
                    setStyle({
                      ...style,
                      inputVariant:
                        value === 'inherit'
                          ? undefined
                          : (value as (typeof FORM_INPUT_VARIANTS)[number]),
                    })
                  }
                  options={[
                    { value: 'inherit', label: 'Inherit' },
                    ...FORM_INPUT_VARIANTS.map((v) => ({ value: v, label: titleCaseWord(v) })),
                  ]}
                />
              </SettingRow>
              <SettingRow label="Accent color">
                <ColorPicker
                  aria-label="Field accent color"
                  allowClear
                  format="hex"
                  showText
                  value={style.accent ?? null}
                  onChangeComplete={(c) => setStyle({ ...style, accent: c.toHexString() })}
                  onClear={() => setStyle({ ...style, accent: undefined })}
                />
              </SettingRow>
            </Space>
          ),
        },
      ]}
    />
  );
}

function titleCaseWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function TypeSpecificSettings({
  field,
  dispatch,
}: {
  field: FormField;
  dispatch: Dispatch<BuilderAction>;
}) {
  switch (field.type) {
    case 'text':
      return <TextValidationSettings field={field} dispatch={dispatch} />;
    case 'textarea':
      return <TextareaValidationSettings field={field} dispatch={dispatch} />;
    case 'dropdown':
    case 'multi_select':
    case 'radio':
      return <OptionsEditor field={field} dispatch={dispatch} />;
    case 'checkbox':
      return <CheckboxConsentSettings field={field} dispatch={dispatch} />;
    case 'number':
      return <NumberValidationSettings field={field} dispatch={dispatch} />;
    case 'rating':
      return <RatingSettings field={field} dispatch={dispatch} />;
    case 'hidden':
      return <HiddenSettings field={field} dispatch={dispatch} />;
    case 'url':
      return (
        <Alert
          type="info"
          showIcon
          message="URL field"
          description="Validated as a URL when the form is submitted."
        />
      );
    case 'file':
      return <FileValidationSettings field={field} dispatch={dispatch} />;
    case 'phone':
      return (
        <Alert
          type="info"
          showIcon
          message="+91, 10 digits"
          description="Indian mobile numbers only."
        />
      );
    case 'heading':
      return <HeadingSettings field={field} dispatch={dispatch} />;
    case 'paragraph':
      return <ParagraphSettings field={field} dispatch={dispatch} />;
    case 'image':
      return <ImageBlockSettings field={field} dispatch={dispatch} />;
    case 'divider':
      return (
        <Alert
          type="info"
          showIcon
          message="Divider"
          description="A horizontal rule shown between fields. Nothing to configure."
        />
      );
    default:
      return null;
  }
}

function HeadingSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'heading' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'heading' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Heading</Divider>
      <SettingRow label="Text">
        <Input
          aria-label="Heading text"
          value={field.text}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </SettingRow>
      <SettingRow label="Level">
        <Segmented
          aria-label="Heading level"
          value={field.level}
          onChange={(value) =>
            patch({ level: value as Extract<FormField, { type: 'heading' }>['level'] })
          }
          options={FORM_HEADING_LEVELS.map((l) => ({ value: l, label: l.toUpperCase() }))}
        />
      </SettingRow>
    </>
  );
}

function ParagraphSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'paragraph' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'paragraph' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Text</Divider>
      <SettingRow label="Text">
        <Input.TextArea
          aria-label="Paragraph text"
          rows={4}
          value={field.text}
          onChange={(e) => patch({ text: e.target.value })}
        />
      </SettingRow>
    </>
  );
}

function ImageBlockSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'image' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'image' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Image</Divider>
      <SettingRow label="Image URL (https)">
        <Input
          aria-label="Image URL"
          placeholder="https://cdn.example.com/image.png"
          value={field.url}
          onChange={(e) => patch({ url: e.target.value.trim() })}
        />
      </SettingRow>
      <SettingRow label="Alt text">
        <Input
          aria-label="Image alt text"
          placeholder="Describes the image for screen readers"
          value={field.alt ?? ''}
          onChange={(e) => patch({ alt: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
    </>
  );
}

function parseIntOr(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

function parseFloatOr(value: string): number | undefined {
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}

function TextValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'text' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? {};
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <div style={{ display: 'flex', gap: 8 }}>
        <SettingRow label="Min length">
          <Input
            aria-label="Min length"
            type="number"
            min={0}
            value={validation.minLength ?? ''}
            onChange={(e) => set({ ...validation, minLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max length">
          <Input
            aria-label="Max length"
            type="number"
            min={1}
            value={validation.maxLength ?? ''}
            onChange={(e) => set({ ...validation, maxLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
      </div>
      <SettingRow label="Pattern (regex)">
        <Input
          aria-label="Pattern"
          placeholder="e.g. ^[A-Z]{2}[0-9]{4}$"
          value={validation.pattern ?? ''}
          onChange={(e) =>
            set({ ...validation, pattern: e.target.value ? e.target.value : undefined })
          }
        />
      </SettingRow>
    </>
  );
}

function TextareaValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'textarea' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { maxLength: 5000 };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <div style={{ display: 'flex', gap: 8 }}>
        <SettingRow label="Min length">
          <Input
            aria-label="Min length"
            type="number"
            min={0}
            value={validation.minLength ?? ''}
            onChange={(e) => set({ ...validation, minLength: parseIntOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label={`Max length (≤ ${FORM_TEXTAREA_HARD_MAX_LENGTH})`}>
          <Input
            aria-label="Max length"
            type="number"
            min={1}
            max={FORM_TEXTAREA_HARD_MAX_LENGTH}
            value={validation.maxLength ?? ''}
            onChange={(e) => {
              const parsed = parseIntOr(e.target.value);
              set({
                ...validation,
                maxLength:
                  parsed === undefined
                    ? validation.maxLength
                    : Math.min(parsed, FORM_TEXTAREA_HARD_MAX_LENGTH),
              });
            }}
          />
        </SettingRow>
      </div>
    </>
  );
}

function OptionsEditor({
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

function FileValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'file' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? {
    allowedMimeTypes: [...FORM_FILE_ALLOWED_MIME_TYPES],
    maxBytes: FORM_FILE_MAX_BYTES,
  };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>File constraints</Divider>
      <SettingRow label="Allowed types">
        <Space direction="vertical" size={4}>
          {FORM_FILE_ALLOWED_MIME_TYPES.map((mime) => (
            <Checkbox
              key={mime}
              checked={validation.allowedMimeTypes.includes(mime)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...validation.allowedMimeTypes, mime]
                  : validation.allowedMimeTypes.filter((m) => m !== mime);
                // At least one type must stay allowed (schema minimum).
                if (next.length === 0) return;
                set({ ...validation, allowedMimeTypes: next });
              }}
            >
              {mime}
            </Checkbox>
          ))}
        </Space>
      </SettingRow>
      <SettingRow label="Max size (bytes, ≤ 5 MB)">
        <Input
          aria-label="Max bytes"
          type="number"
          min={1}
          max={FORM_FILE_MAX_BYTES}
          value={validation.maxBytes}
          onChange={(e) => {
            const parsed = parseIntOr(e.target.value);
            if (parsed === undefined) return;
            set({ ...validation, maxBytes: Math.min(parsed, FORM_FILE_MAX_BYTES) });
          }}
        />
      </SettingRow>
    </>
  );
}

function CheckboxConsentSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'checkbox' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'checkbox' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Consent link</Divider>
      <SettingRow label="Link text">
        <Input
          aria-label="Link text"
          placeholder="e.g. Privacy policy"
          value={field.linkText ?? ''}
          onChange={(e) => patch({ linkText: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
      <SettingRow label="Link URL (https)">
        <Input
          aria-label="Link URL"
          placeholder="https://example.com/privacy"
          value={field.linkUrl ?? ''}
          onChange={(e) => patch({ linkUrl: e.target.value ? e.target.value : undefined })}
        />
      </SettingRow>
    </>
  );
}

function NumberValidationSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'number' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const validation = field.validation ?? { integer: false };
  const set = (v: typeof validation) =>
    dispatch({ type: 'updateField', key: field.key, patch: { validation: v } });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Validation</Divider>
      <div style={{ display: 'flex', gap: 8 }}>
        <SettingRow label="Min">
          <Input
            aria-label="Min"
            type="number"
            value={validation.min ?? ''}
            onChange={(e) => set({ ...validation, min: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Max">
          <Input
            aria-label="Max"
            type="number"
            value={validation.max ?? ''}
            onChange={(e) => set({ ...validation, max: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Step">
          <Input
            aria-label="Step"
            type="number"
            min={0}
            value={validation.step ?? ''}
            onChange={(e) => set({ ...validation, step: parseFloatOr(e.target.value) })}
          />
        </SettingRow>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Switch
          aria-label="Integer only"
          checked={validation.integer}
          onChange={(checked) => set({ ...validation, integer: checked })}
        />
        <Typography.Text>Integer only</Typography.Text>
      </div>
    </>
  );
}

function RatingSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'rating' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'rating' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Rating</Divider>
      <SettingRow label="Max (3-10)">
        <Input
          aria-label="Max rating"
          type="number"
          min={3}
          max={10}
          value={field.max}
          onChange={(e) => {
            const parsed = parseIntOr(e.target.value);
            if (parsed === undefined) return;
            patch({ max: Math.min(10, Math.max(3, parsed)) });
          }}
        />
      </SettingRow>
      <SettingRow label="Icon">
        <RadioGroup
          value={field.icon}
          onChange={(e) =>
            patch({ icon: e.target.value as Extract<FormField, { type: 'rating' }>['icon'] })
          }
        >
          {FORM_RATING_ICONS.map((icon) => (
            <Radio key={icon} value={icon}>
              {icon === 'heart' ? 'Heart' : 'Star'}
            </Radio>
          ))}
        </RadioGroup>
      </SettingRow>
    </>
  );
}

function HiddenSettings({
  field,
  dispatch,
}: {
  field: Extract<FormField, { type: 'hidden' }>;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<Extract<FormField, { type: 'hidden' }>>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <>
      <Divider style={{ margin: '4px 0' }}>Hidden capture</Divider>
      <SettingRow label="URL parameter name">
        <Input
          aria-label="Param name"
          placeholder="e.g. utm_source"
          value={field.paramName}
          onChange={(e) => patch({ paramName: e.target.value })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Captured from the page URL query string; never shown to the visitor.
        </Typography.Text>
      </SettingRow>
    </>
  );
}

function FormSettings({
  state,
  dispatch,
  onWebhookTest,
  webhookTestPending,
  webhookTestResult,
}: {
  state: BuilderState;
  dispatch: Dispatch<BuilderAction>;
  onWebhookTest: () => void;
  webhookTestPending: boolean;
  webhookTestResult: { statusCode: number | null } | null;
}) {
  const patch = (p: Partial<BuilderState['meta']>) => dispatch({ type: 'updateMeta', patch: p });
  return (
    <Card title="Form settings">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <SettingRow label="Name">
          <Input
            aria-label="Form name"
            value={state.meta.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Description">
          <Input.TextArea
            aria-label="Form description"
            rows={2}
            placeholder="Optional subtitle shown under the form title"
            value={state.meta.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Submit button label">
          <Input
            aria-label="Submit label"
            value={state.meta.submitLabel}
            onChange={(e) => patch({ submitLabel: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Success message">
          <Input.TextArea
            aria-label="Success message"
            rows={2}
            value={state.meta.successMessage}
            onChange={(e) => patch({ successMessage: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Redirect URL (https)">
          <Input
            aria-label="Redirect URL"
            placeholder="https:// page to send visitors to after submitting"
            value={state.meta.redirectUrl}
            onChange={(e) => patch({ redirectUrl: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Spam protection">
          <RadioGroup
            value={state.meta.spamProtection}
            onChange={(e) => patch({ spamProtection: e.target.value as 'recaptcha' | 'honeypot' })}
          >
            <Radio value="recaptcha">reCAPTCHA v3</Radio>
            <Radio value="honeypot">Honeypot</Radio>
          </RadioGroup>
        </SettingRow>
        <SettingRow label="Notification email">
          <Input
            aria-label="Notification email"
            placeholder="Falls back to the Config default"
            value={state.meta.notificationEmail}
            onChange={(e) => patch({ notificationEmail: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Webhook URL">
          <Input
            aria-label="Webhook URL"
            placeholder="https:// endpoint for form.submitted"
            value={state.meta.webhookUrl}
            onChange={(e) => patch({ webhookUrl: e.target.value })}
          />
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              disabled={!state.meta.webhookUrl.trim()}
              loading={webhookTestPending}
              onClick={onWebhookTest}
            >
              Send test payload
            </Button>
            {webhookTestResult && (
              <Typography.Text style={{ display: 'block', marginTop: 4 }}>
                {webhookTestResult.statusCode === null
                  ? 'Webhook test sent, no response (network error)'
                  : `Webhook responded with status ${webhookTestResult.statusCode}`}
              </Typography.Text>
            )}
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, display: 'block', marginTop: 4 }}
            >
              Tests the saved webhook URL. Save first if you just changed it.
            </Typography.Text>
          </div>
        </SettingRow>
      </Space>
    </Card>
  );
}
