import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  Alert,
  ArrowLeftOutlined,
  Button,
  Card,
  Collapse,
  ColorPicker,
  Divider,
  Input,
  message,
  PrimaryButton,
  Radio,
  RadioGroup,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from '@primathonos/orion';
import {
  FORM_FIELD_WIDTHS,
  FORM_INPUT_VARIANTS,
  type FormField,
  type FormFieldType,
  formInputSchema,
  isAdornable,
  isCollectableFieldType,
  supportsCounter,
} from '@shared/schemas/form-schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { type Dispatch, useEffect, useReducer, useState } from 'react';
import { CanvasField } from '@/components/CanvasField';
import { DesignSettings } from '@/components/DesignSettings';
import { FieldPalette, PALETTE_PREFIX } from '@/components/FieldPalette';
import { LivePreview } from '@/components/LivePreview';
// Per-field settings panels (Phase 0 refactor): TypeSpecificSettings dispatches
// through this registry; each panel lives in @/fields/<type>/settings.tsx.
import { SettingRow, SettingRowGroup } from '@/fields/_shared/controls';
import { fieldSettingsRegistry } from '@/fields/registry';
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

/** The three-pane form builder (PRD "Form builder", TRD §2, TDD §4). */
export function BuilderScreen({ formId }: { formId: string }) {
  const form = useForm(formId);
  const update = useUpdateForm(formId);
  const toggle = useToggleFormStatus();
  const webhookTest = useWebhookTest(formId);
  const [state, dispatch] = useReducer(builderReducer, EMPTY_BUILDER_STATE);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Live preview is a collapsible full-width panel at the top (B2). Collapsed by
  // default so the editor row keeps all its vertical space; the header switch
  // reveals it above the palette/canvas/settings row, where it has the width to
  // render a real desktop frame.
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
          <Space size={8}>
            <Switch
              aria-label="Live preview"
              checked={previewOpen}
              onChange={setPreviewOpen}
            />
            <Typography.Text>Live preview</Typography.Text>
          </Space>
          <Link to="/submissions/$formId" params={{ formId }}>
            <Button>Submissions</Button>
          </Link>
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

      {previewOpen && (
        <LivePreview
          name={state.meta.name}
          fields={state.fields}
          submitLabel={state.meta.submitLabel}
          successMessage={state.meta.successMessage}
          description={state.meta.description}
          appearance={state.meta.appearance}
        />
      )}

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
    </Space>
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
        <SettingRowGroup>
          <SettingRow label="Prefix" style={{ flex: 1 }}>
            <Input
              aria-label="Prefix"
              maxLength={8}
              placeholder="e.g. $"
              value={field.prefix ?? ''}
              onChange={(e) => patch({ prefix: e.target.value || undefined })}
            />
          </SettingRow>
          <SettingRow label="Suffix" style={{ flex: 1 }}>
            <Input
              aria-label="Suffix"
              maxLength={8}
              placeholder="e.g. .com"
              value={field.suffix ?? ''}
              onChange={(e) => patch({ suffix: e.target.value || undefined })}
            />
          </SettingRow>
        </SettingRowGroup>
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
                {/* A Select instead of a Segmented (B5): the 4 variant labels
                    overflow the ~280px settings panel, so a full-width Select
                    keeps every option (including "Underlined") in bounds. */}
                <Select
                  aria-label="Field input style"
                  style={{ width: '100%' }}
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
  // Dispatch to the per-field settings panel (Phase 0 registry). email/date map
  // to null (no type-specific settings), matching the old switch default.
  const Panel = fieldSettingsRegistry[field.type];
  if (!Panel) return null;
  return <Panel field={field} dispatch={dispatch} />;
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
