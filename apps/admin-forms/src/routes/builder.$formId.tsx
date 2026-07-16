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
  DeleteOutlined,
  Divider,
  HolderOutlined,
  Input,
  message,
  PrimaryButton,
  Radio,
  RadioGroup,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from '@primathonos/orion';
import {
  FORM_FIELD_TYPES,
  FORM_FILE_ALLOWED_MIME_TYPES,
  FORM_FILE_MAX_BYTES,
  FORM_TEXTAREA_HARD_MAX_LENGTH,
  type FormField,
  type FormFieldType,
  formInputSchema,
} from '@shared/schemas/form-schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { type Dispatch, useEffect, useReducer, useState } from 'react';
import { FormPreview } from '@/components/FormPreview';
import { useForm, useToggleFormStatus, useUpdateForm } from '@/hooks/useForms';
import { useWebhookTest } from '@/hooks/useWebhookTest';
import {
  type BuilderAction,
  type BuilderState,
  builderReducer,
  EMPTY_BUILDER_STATE,
  FIELD_TYPE_LABELS,
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
    const payload = {
      name: state.meta.name,
      schema: state.fields,
      submitLabel: state.meta.submitLabel,
      successMessage: state.meta.successMessage,
      spamProtection: state.meta.spamProtection,
      ...(state.meta.notificationEmail.trim()
        ? { notificationEmail: state.meta.notificationEmail.trim() }
        : {}),
      ...(state.meta.webhookUrl.trim() ? { webhookUrl: state.meta.webhookUrl.trim() } : {}),
    };
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
              mode="mobile"
            />
          </Card>
          <Card title="Desktop" style={{ flex: 1, minWidth: 320 }}>
            <FormPreview
              name={state.meta.name}
              fields={state.fields}
              submitLabel={state.meta.submitLabel}
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
                <FormSettings
                  state={state}
                  dispatch={dispatch}
                  onWebhookTest={() =>
                    webhookTest.mutate(undefined, {
                      onSuccess: (result) =>
                        void message.info(
                          result.statusCode === null
                            ? 'Webhook test sent — no response (network error)'
                            : `Webhook responded with status ${result.statusCode}`,
                        ),
                      onError: (err) => void message.error((err as Error).message),
                    })
                  }
                  webhookTestPending={webhookTest.isPending}
                  webhookTestResult={webhookTest.data ?? null}
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
        aria-label={`Reorder ${field.label}`}
        style={{ cursor: 'grab', color: '#999', display: 'inline-flex' }}
      >
        <HolderOutlined />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text strong style={{ display: 'block' }}>
          {field.label}
          {field.required && <span style={{ color: '#cf1322' }}> *</span>}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {FIELD_TYPE_LABELS[field.type]} ({field.key})
        </Typography.Text>
      </div>
      <Button
        type="text"
        size="small"
        danger
        aria-label={`Delete ${field.label}`}
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

function FieldSettings({
  field,
  dispatch,
}: {
  field: FormField;
  dispatch: Dispatch<BuilderAction>;
}) {
  const patch = (p: Partial<FormField>) =>
    dispatch({ type: 'updateField', key: field.key, patch: p });
  return (
    <Card
      title={`${FIELD_TYPE_LABELS[field.type]} field`}
      extra={
        <Button size="small" onClick={() => dispatch({ type: 'selectField', key: null })}>
          Done
        </Button>
      }
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <SettingRow label="Label">
          <Input
            aria-label="Field label"
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </SettingRow>
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
        <SettingRow label="Placeholder">
          <Input
            aria-label="Field placeholder"
            value={field.placeholder ?? ''}
            onChange={(e) => patch({ placeholder: e.target.value })}
          />
        </SettingRow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch
            aria-label="Required"
            checked={field.required}
            onChange={(checked) => patch({ required: checked })}
          />
          <Typography.Text>Required</Typography.Text>
        </div>
        <TypeSpecificSettings field={field} dispatch={dispatch} />
      </Space>
    </Card>
  );
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
      return <OptionsEditor field={field} dispatch={dispatch} />;
    case 'file':
      return <FileValidationSettings field={field} dispatch={dispatch} />;
    case 'phone':
      return (
        <Alert
          type="info"
          showIcon
          message="+91, 10 digits"
          description="Indian mobile numbers only in v1. Validated on the storefront and again on the server."
        />
      );
    default:
      return null;
  }
}

function parseIntOr(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
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
  field: Extract<FormField, { type: 'dropdown' | 'multi_select' }>;
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
                  ? 'Webhook test sent — no response (network error)'
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
