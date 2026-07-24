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

export const Route = createFileRoute('/rules')({ component: RulesPage });

interface RuleFormState {
  name: string;
  ruleType: 'MULTIPLIER' | 'BONUS';
  value: string;
  targetType: 'SEGMENT' | 'CUSTOMER_LIST';
  conditions: LoyaltyConditionGroup;
  startsAt: string;
  endsAt: string;
  priority: string;
  active: boolean;
}

function emptyForm(): RuleFormState {
  return {
    name: '',
    ruleType: 'MULTIPLIER',
    value: '2',
    targetType: 'SEGMENT',
    conditions: makeGroup('AND'),
    startsAt: new Date().toISOString().slice(0, 16),
    endsAt: '',
    priority: '0',
    active: true,
  };
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
    ruleType: rule.ruleType,
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
  const [errors, setErrors] = useState<string[]>([]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setErrors([]);
    setFormOpen(true);
  };
  const openEdit = (rule: LoyaltyRule) => {
    setEditing(rule);
    setForm(formFromRule(rule));
    setErrors([]);
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
      setErrors(
        parsed.error.issues.map((issue) =>
          issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        ),
      );
      return;
    }
    setErrors([]);
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
      setErrors([err instanceof Error ? err.message : 'Save failed']);
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Type', dataIndex: 'ruleType', key: 'ruleType' },
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
        return rule.ruleType === 'MULTIPLIER' ? `${rule.value}×` : `+${rule.value} coins`;
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
            <FieldRow label="Rule name">
              <Input
                placeholder="VIP 3x multiplier"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FieldRow>

            <FieldRow label="Rule type">
              <RadioGroup
                value={form.ruleType}
                onChange={(e) =>
                  setForm({ ...form, ruleType: e.target.value as 'MULTIPLIER' | 'BONUS' })
                }
                options={[
                  { label: 'Multiplier', value: 'MULTIPLIER' },
                  { label: 'Bonus', value: 'BONUS' },
                ]}
              />
            </FieldRow>

            <FieldRow
              label={
                form.ruleType === 'MULTIPLIER'
                  ? 'Multiplier (× base earn)'
                  : 'Bonus coins per order'
              }
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

            <FieldRow label="Target">
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
              <FieldRow label="Segment conditions">
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

            <Space wrap size="large">
              <FieldRow label="Starts at">
                <input
                  type="datetime-local"
                  aria-label="Starts at"
                  value={form.startsAt}
                  onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                  style={{ padding: '4px 8px' }}
                />
              </FieldRow>
              <FieldRow label="Ends at (optional)">
                <input
                  type="datetime-local"
                  aria-label="Ends at"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                  style={{ padding: '4px 8px' }}
                />
              </FieldRow>
              <FieldRow label="Priority (higher wins)">
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

            {errors.length > 0 && (
              <Alert
                type="error"
                showIcon
                message="Rule is invalid"
                description={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {errors.map((error) => (
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
  const customers = useRuleCustomers(ruleId, page);
  const append = useAppendRuleCustomers();
  const remove = useRemoveRuleCustomers();

  const parsePhones = (text: string): string[] =>
    text
      .split(/[\n,;]+/)
      .map((phone) => phone.trim())
      .filter(Boolean);

  const handleAppend = async () => {
    const phones = parsePhones(phonesText);
    if (phones.length === 0) return;
    const result = await append.mutateAsync({ id: ruleId, phones });
    setFeedback(`Added ${result.added} phone(s); ${result.invalid} invalid.`);
    setPhonesText('');
  };

  return (
    <Card title="Customer list">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <textarea
          aria-label="Phones to append"
          placeholder={'One phone per line (or comma-separated)\n9876543210\n9876500000'}
          value={phonesText}
          onChange={(e) => setPhonesText(e.target.value)}
          rows={4}
          style={{ width: '100%', padding: 8, fontFamily: 'monospace' }}
        />
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}
