import {
  Alert,
  Button,
  Card,
  DangerButton,
  Empty,
  Input,
  PrimaryButton,
  RadioGroup,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import { type LoyaltyConditionGroup, loyaltyRuleInputSchema } from '@shared/schemas/loyalty-rules';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ConditionTreeBuilder, isGroup, makeGroup } from '@/components/ConditionTreeBuilder';
import { FieldRow } from '@/components/FieldRow';
import {
  type LoyaltyRule,
  type LoyaltyRulePayload,
  useAppendRuleCustomers,
  useCreateRule,
  useDeleteRule,
  useRemoveRuleCustomers,
  useRuleCustomers,
  useRulePerformance,
  useRules,
  useSetRuleActive,
  useUpdateRule,
} from '@/hooks/useLoyalty';
import { ApiException } from '@/lib/api';
import { normalizeBulkPhone } from '@/lib/parse-csv';

export const Route = createFileRoute('/rules')({ component: RulesPage });

interface RuleFormState {
  name: string;
  /**
   * Always 'BONUS'. MULTIPLIER rules were retired 2026-07-31 — their extra was
   * `(m − 1) × orderTotal × baseEarnRate`, and the base earn rate is owned by
   * Core Loyalty and no longer stored (Core exposes no endpoint to read it
   * back). Legacy MULTIPLIER rows stay readable and are flagged in the table.
   */
  ruleType: 'BONUS';
  value: string;
  targetType: 'SEGMENT' | 'CUSTOMER_LIST';
  conditions: LoyaltyConditionGroup;
  startsAt: string;
  endsAt: string;
  priority: string;
  active: boolean;
}

/** Validation messages keyed by the field they belong to. */
type RuleFieldErrors = Partial<Record<keyof RuleFormState, string>>;

/**
 * Turn zod issues into per-field messages. The shared rule schema already
 * tags its cross-field refinements with an explicit `path` (`conditions`,
 * `value`, `endsAt`), so the first path segment is the field to blame. The
 * first message per field wins — piling three messages onto one input is
 * noise, not detail.
 */
function toFieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): {
  fields: RuleFieldErrors;
  formLevel: string[];
} {
  const fields: RuleFieldErrors = {};
  const formLevel: string[] = [];
  for (const issue of issues) {
    const key = issue.path[0] as keyof RuleFormState | undefined;
    if (key && key in emptyForm()) {
      if (!fields[key]) fields[key] = issue.message;
    } else {
      formLevel.push(issue.message);
    }
  }
  return { fields, formLevel };
}

/** Server guards that belong on a specific field rather than the form banner. */
const SERVER_ERROR_FIELDS: Record<string, keyof RuleFieldErrors | undefined> = {
  DUPLICATE_PRIORITY: 'priority',
  START_IN_PAST: 'startsAt',
  END_IN_PAST: 'endsAt',
  EMPTY_CUSTOMER_LIST: 'targetType',
};

function emptyForm(): RuleFormState {
  return {
    name: '',
    ruleType: 'BONUS',
    value: '50',
    targetType: 'SEGMENT',
    conditions: makeGroup('AND'),
    // LOCAL time, not `toISOString().slice(0,16)`. A `datetime-local` value is
    // read back as local, so the UTC form made every new rule default to
    // (now − UTC offset) — 5½ hours in the past for an IST merchant, silently
    // backdating the rule before anyone touched the field.
    startsAt: nowLocalInput(),
    endsAt: '',
    priority: '0',
    active: true,
  };
}

/** `datetime-local` floor for "no earlier than now", in the browser's zone. */
function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString());
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function formFromRule(rule: LoyaltyRule): RuleFormState {
  return {
    name: rule.name,
    // A legacy MULTIPLIER row edits as a flat bonus — the form warns about it.
    ruleType: 'BONUS',
    value: String(rule.value),
    targetType: rule.targetType,
    conditions:
      rule.conditions && isGroup(rule.conditions)
        ? rule.conditions
        : rule.conditions
          ? { op: 'AND', children: [rule.conditions] }
          : makeGroup('AND'),
    startsAt: toLocalInput(rule.startsAt),
    endsAt: toLocalInput(rule.endsAt),
    priority: String(rule.priority),
    active: rule.active,
  };
}

export function RulesPage() {
  const rules = useRules();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const setActive = useSetRuleActive();

  const [editing, setEditing] = useState<LoyaltyRule | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RuleFormState>(emptyForm());
  const [errors, setErrors] = useState<RuleFieldErrors>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // Membership of the rule under edit, so the form can refuse to activate a
  // customer-list rule that targets nobody. `null` id keeps the query idle.
  const editingCustomers = useRuleCustomers(
    editing && editing.targetType === 'CUSTOMER_LIST' ? editing.id : null,
    1,
  );
  // Only decide once the count has actually loaded — never block on `undefined`.
  const hasNoCustomers = editingCustomers.data?.total === 0;

  const resetErrors = () => {
    setErrors({});
    setFormErrors([]);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    resetErrors();
    setFormOpen(true);
  };
  const openEdit = (rule: LoyaltyRule) => {
    setEditing(rule);
    setForm(formFromRule(rule));
    resetErrors();
    setFormOpen(true);
  };

  const submit = async () => {
    const candidate = {
      name: form.name,
      ruleType: form.ruleType,
      value: Number(form.value),
      targetType: form.targetType,
      conditions: form.targetType === 'SEGMENT' ? form.conditions : null,
      startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt) : null,
      active: form.active,
      priority: Number(form.priority),
    };
    const parsed = loyaltyRuleInputSchema.safeParse(candidate);
    if (!parsed.success) {
      const { fields, formLevel } = toFieldErrors(parsed.error.issues);
      setErrors(fields);
      setFormErrors(formLevel);
      return;
    }

    // Rules the shared schema can't express: they need the other rules, or
    // "now". Reported against their own field, before the round-trip.
    const local: RuleFieldErrors = {};

    // Priority is the evaluator's tie-break (ORDER BY priority DESC), so two
    // rules at the same priority make the winner depend on row order.
    const clash = (rules.data ?? []).find(
      (r) => r.priority === parsed.data.priority && r.id !== editing?.id,
    );
    if (clash)
      local.priority = `Priority ${parsed.data.priority} is already used by "${clash.name}".`;

    // Only for a NEW rule: an existing one legitimately keeps the start date
    // it was created with, so editing must not be blocked by its own past.
    if (!editing) {
      const floor = Date.now() - 60_000;
      if (parsed.data.startsAt.getTime() < floor)
        local.startsAt = 'Start date cannot be in the past.';
      if (parsed.data.endsAt && parsed.data.endsAt.getTime() < floor) {
        local.endsAt = 'End date cannot be in the past.';
      }
    }

    // An active customer-list rule with an empty list matches nobody, so it
    // looks live while doing nothing.
    if (
      parsed.data.targetType === 'CUSTOMER_LIST' &&
      parsed.data.active &&
      editing &&
      hasNoCustomers
    ) {
      local.targetType = 'Add at least one customer below before activating this rule.';
    }

    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFormErrors([]);
      return;
    }
    resetErrors();
    const payload: LoyaltyRulePayload = {
      name: parsed.data.name,
      ruleType: parsed.data.ruleType,
      value: parsed.data.value,
      targetType: parsed.data.targetType,
      conditions: parsed.data.conditions ?? null,
      startsAt: parsed.data.startsAt.toISOString(),
      endsAt: parsed.data.endsAt ? parsed.data.endsAt.toISOString() : null,
      active: parsed.data.active,
      priority: parsed.data.priority,
    };
    try {
      if (editing) {
        await updateRule.mutateAsync({ id: editing.id, input: payload });
      } else {
        await createRule.mutateAsync(payload);
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      // The same three guards exist server-side (another admin tab, or a
      // direct API call, can still race us) — land them on their field.
      if (err instanceof ApiException) {
        const field = SERVER_ERROR_FIELDS[err.errorCode ?? ''];
        if (field) {
          setErrors({ [field]: err.message });
          setFormErrors([]);
          return;
        }
      }
      setFormErrors([err instanceof Error ? err.message : 'Save failed']);
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Type',
      dataIndex: 'ruleType',
      key: 'ruleType',
      render: (value: unknown) => (value === 'MULTIPLIER' ? 'MULTIPLIER' : 'BONUS'),
    },
    {
      title: 'Target',
      dataIndex: 'targetType',
      key: 'targetType',
      render: (value: unknown) => <Tag>{value === 'SEGMENT' ? 'Segment' : 'Customer list'}</Tag>,
    },
    {
      title: 'Value',
      dataIndex: 'value',
      key: 'value',
      render: (_value: unknown, record: unknown) => {
        const rule = record as LoyaltyRule;
        if (rule.ruleType !== 'MULTIPLIER') return `+${rule.value} coins`;
        // Retired type — it no longer grants anything; say so rather than
        // rendering `3×` as though it were still being applied.
        return (
          <Space size="small">
            <span>{rule.value}×</span>
            <Tag color="red">retired</Tag>
          </Space>
        );
      },
    },
    { title: 'Priority', dataIndex: 'priority', key: 'priority' },
    {
      title: 'Active',
      dataIndex: 'active',
      key: 'active',
      render: (_value: unknown, record: unknown) => {
        const rule = record as LoyaltyRule;
        return (
          <Switch
            checked={rule.active}
            aria-label={`Toggle ${rule.name}`}
            onChange={(checked) => setActive.mutate({ id: rule.id, active: checked })}
          />
        );
      },
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      key: 'actions',
      render: (_value: unknown, record: unknown) => {
        const rule = record as LoyaltyRule;
        return (
          <Space>
            <Button size="small" onClick={() => openEdit(rule)}>
              Edit
            </Button>
            <DangerButton size="small" onClick={() => deleteRule.mutate(rule.id)}>
              Delete
            </DangerButton>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Typography.Title level={2} style={{ marginBottom: 0 }}>
            Earning rules
          </Typography.Title>
          <Typography.Text type="secondary">
            Grant extra coins on orders — multipliers or flat bonuses, targeted at segments or
            uploaded customer lists.
          </Typography.Text>
        </div>
        <PrimaryButton onClick={openCreate}>New rule</PrimaryButton>
      </div>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rules.data ?? []}
          loading={rules.isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No earning rules yet" /> }}
        />
      </Card>

      {formOpen && (
        <Card title={editing ? `Edit rule — ${editing.name}` : 'New rule'}>
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            {editing?.ruleType === 'MULTIPLIER' && (
              <Alert
                type="warning"
                showIcon
                message="This is a retired multiplier rule"
                description="Multiplier rules are no longer applied — Core Loyalty owns the order earn rate, so the extra can't be calculated. Saving converts this rule to a flat bonus of the coins you enter below."
              />
            )}

            <FieldRow label="Rule name" required error={errors.name}>
              <Input
                placeholder="VIP 3x multiplier"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                {...(errors.name ? { status: 'error' as const } : {})}
              />
            </FieldRow>

            <FieldRow
              label="Bonus coins per order"
              required
              error={errors.value}
              hint="Flat coins granted on top of what Core Loyalty already awards for the order"
            >
              <input
                type="number"
                aria-label="Rule value"
                value={form.value}
                min={0}
                step="0.1"
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                style={{ padding: '4px 8px', width: 160 }}
              />
            </FieldRow>

            <FieldRow label="Target" required error={errors.targetType}>
              <RadioGroup
                value={form.targetType}
                onChange={(e) =>
                  setForm({ ...form, targetType: e.target.value as 'SEGMENT' | 'CUSTOMER_LIST' })
                }
                options={[
                  { label: 'Segment (conditions)', value: 'SEGMENT' },
                  { label: 'Customer list', value: 'CUSTOMER_LIST' },
                ]}
              />
            </FieldRow>

            {form.targetType === 'SEGMENT' ? (
              <FieldRow label="Segment conditions" required error={errors.conditions}>
                <ConditionTreeBuilder
                  value={form.conditions}
                  onChange={(conditions) => setForm({ ...form, conditions })}
                />
              </FieldRow>
            ) : (
              <Alert
                type="info"
                showIcon
                message={
                  editing
                    ? 'Manage the phone list below.'
                    : 'Save the rule first, then upload/append the phone list on the edit view.'
                }
              />
            )}

            <Space wrap size="large" align="start">
              <FieldRow label="Starts at" required error={errors.startsAt}>
                <input
                  type="datetime-local"
                  aria-label="Starts at"
                  value={form.startsAt}
                  // New rules can't start in the past; an existing rule keeps
                  // whatever start date it already has, so no floor on edit.
                  {...(editing ? {} : { min: nowLocalInput() })}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                  style={{ padding: '4px 8px' }}
                />
              </FieldRow>
              <FieldRow label="Ends at (optional)" error={errors.endsAt}>
                <input
                  type="datetime-local"
                  aria-label="Ends at"
                  value={form.endsAt}
                  // Never before the start, and never in the past for a new rule.
                  min={form.startsAt || (editing ? undefined : nowLocalInput())}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                  style={{ padding: '4px 8px' }}
                />
              </FieldRow>
              <FieldRow label="Priority (higher wins)" error={errors.priority}>
                <input
                  type="number"
                  aria-label="Priority"
                  value={form.priority}
                  min={0}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  style={{ padding: '4px 8px', width: 120 }}
                />
              </FieldRow>
            </Space>

            {/* Only whole-form problems land here now — anything attributable to
                a field is rendered against that field above. */}
            {formErrors.length > 0 && (
              <Alert
                type="error"
                showIcon
                message="Rule could not be saved"
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {formErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                }
              />
            )}

            <Space>
              <PrimaryButton
                onClick={() => void submit()}
                loading={createRule.isPending || updateRule.isPending}
              >
                {editing ? 'Save rule' : 'Create rule'}
              </PrimaryButton>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            </Space>
          </Space>
        </Card>
      )}

      {editing && <RuleDetail rule={editing} />}
    </Space>
  );
}

function RuleDetail({ rule }: { rule: LoyaltyRule }) {
  const performance = useRulePerformance(rule.id);
  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Card title="Performance" loading={performance.isLoading}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <PerfStat title="Orders matched" value={performance.data?.matches} />
          <PerfStat title="Extra coins granted" value={performance.data?.extraCoins} />
          <PerfStat title="Unique customers" value={performance.data?.uniqueCustomers} />
        </div>
      </Card>
      {rule.targetType === 'CUSTOMER_LIST' && <RuleCustomerList ruleId={rule.id} />}
    </Space>
  );
}

function PerfStat({ title, value }: { title: string; value: number | undefined }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
        {title}
      </Typography.Text>
      <Typography.Text strong style={{ fontSize: 20 }}>
        {value === undefined ? '—' : value.toLocaleString('en-IN')}
      </Typography.Text>
    </div>
  );
}

function RuleCustomerList({ ruleId }: { ruleId: string }) {
  const [page, setPage] = useState(1);
  const [phonesText, setPhonesText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const customers = useRuleCustomers(ruleId, page);
  const append = useAppendRuleCustomers();
  const remove = useRemoveRuleCustomers();

  const parsePhones = (text: string): string[] =>
    text
      .split(/[\n,;]+/)
      .map((phone) => phone.trim())
      .filter(Boolean);

  const handleAppend = async () => {
    setFeedback(null);
    setPhoneError(null);
    const phones = parsePhones(phonesText);
    if (phones.length === 0) {
      setPhoneError('Enter at least one phone number.');
      return;
    }

    // Validate BEFORE posting and keep the text where it is. The old flow
    // posted everything, reported "N invalid" as a bland success banner and
    // then cleared the box — so the numbers you needed to fix were gone and
    // you had no idea which ones they were.
    const bad = phones.filter((phone) => !normalizeBulkPhone(phone));
    if (bad.length > 0) {
      const shown = bad.slice(0, 3).join(', ');
      setPhoneError(
        `${bad.length} invalid number${bad.length === 1 ? '' : 's'} (${shown}${
          bad.length > 3 ? ', …' : ''
        }) — Indian mobile, 10 digits starting 6-9. Fix them and append again.`,
      );
      return;
    }

    const result = await append.mutateAsync({ id: ruleId, phones });
    setFeedback(`Added ${result.added} phone(s).`);
    setPhonesText(''); // cleared only now that every number landed
  };

  return (
    <Card title="Customer list">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <FieldRow label="Phone numbers" error={phoneError ?? undefined}>
          <textarea
            aria-label="Phones to append"
            placeholder={'One phone per line (or comma-separated)\n9876543210\n9876500000'}
            value={phonesText}
            onChange={(e) => {
              setPhonesText(e.target.value);
              if (phoneError) setPhoneError(null); // clear as soon as they edit
            }}
            rows={4}
            style={{
              width: '100%',
              padding: 8,
              fontFamily: 'monospace',
              ...(phoneError ? { borderColor: '#ff4d4f' } : {}),
            }}
          />
        </FieldRow>
        <Space>
          <PrimaryButton onClick={() => void handleAppend()} loading={append.isPending}>
            Append phones
          </PrimaryButton>
          <label>
            <Button onClick={() => document.getElementById(`rule-csv-${ruleId}`)?.click()}>
              Upload CSV
            </Button>
            <input
              id={`rule-csv-${ruleId}`}
              type="file"
              accept=".csv,text/csv"
              aria-label="Phones CSV"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPhonesText(await file.text());
              }}
            />
          </label>
        </Space>
        {feedback && <Alert type="success" showIcon message={feedback} />}

        <Typography.Text type="secondary">
          {customers.data ? `${customers.data.total} phone(s) in this list` : 'Loading…'}
        </Typography.Text>
        <Table
          rowKey={(phone) => String(phone)}
          columns={[
            {
              title: 'Phone',
              dataIndex: 'phone',
              key: 'phone',
              render: (_value: unknown, record: unknown) => String(record),
            },
            {
              title: '',
              dataIndex: 'remove',
              key: 'remove',
              render: (_value: unknown, record: unknown) => (
                <Button
                  size="small"
                  onClick={() => remove.mutate({ id: ruleId, phones: [String(record)] })}
                >
                  Remove
                </Button>
              ),
            },
          ]}
          dataSource={(customers.data?.items ?? []) as unknown as object[]}
          loading={customers.isLoading}
          pagination={{
            current: page,
            pageSize: customers.data?.limit ?? 20,
            total: customers.data?.total ?? 0,
            onChange: (p) => setPage(p),
          }}
          locale={{ emptyText: <Empty description="No phones in this list yet" /> }}
        />
      </Space>
    </Card>
  );
}
