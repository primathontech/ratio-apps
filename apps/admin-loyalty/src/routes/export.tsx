import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  PrimaryButton,
  Space,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import {
  LOYALTY_EXPORT_EMAIL_THRESHOLD,
  LOYALTY_FILTER_FIELDS,
  type LoyaltyCustomerFilter,
  type LoyaltyCustomerFilters,
  type LoyaltyFilterField,
  loyaltyCustomerFilterSchema,
} from '@shared/schemas/loyalty-export';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useConfig } from '@/hooks/useConfig';
import { type ExportJob, useCreateExport, useCustomers, useExports } from '@/hooks/useLoyalty';
import { ApiException } from '@/lib/api';
import { downloadAuthenticated } from '@/lib/download';

export const Route = createFileRoute('/export')({ component: ExportPage });

const NUMERIC_FIELDS: LoyaltyFilterField[] = [
  'points_balance',
  'lifetime_earned',
  'lifetime_redeemed',
  'lifetime_spend',
  'lifetime_orders',
];

const FIELD_LABELS: Record<LoyaltyFilterField, string> = {
  points_balance: 'Coins balance',
  lifetime_earned: 'Lifetime earned',
  lifetime_redeemed: 'Lifetime redeemed',
  lifetime_spend: 'Lifetime spend (₹)',
  lifetime_orders: 'Lifetime orders',
  last_order_at: 'Last order date',
  in_rule: 'In rule (rule id)',
  scanned_qr: 'Scanned QR (qr id)',
};

const OPERATOR_LABELS: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  between: 'between',
  before: 'before',
  after: 'after',
};

type FieldKind = 'numeric' | 'date' | 'id';

function kindOf(field: LoyaltyFilterField): FieldKind {
  if (NUMERIC_FIELDS.includes(field)) return 'numeric';
  if (field === 'last_order_at') return 'date';
  return 'id';
}

function operatorsFor(field: LoyaltyFilterField): string[] {
  switch (kindOf(field)) {
    case 'numeric':
      return ['gt', 'gte', 'lt', 'lte', 'eq', 'between'];
    case 'date':
      return ['before', 'after', 'between'];
    case 'id':
      return ['eq'];
  }
}

interface FilterRow {
  field: LoyaltyFilterField;
  operator: string;
  value1: string;
  value2: string;
}

function emptyRow(): FilterRow {
  return { field: 'points_balance', operator: 'gt', value1: '', value2: '' };
}

/** Build a shared-schema filter from a UI row, or null if it doesn't validate. */
function rowToFilter(row: FilterRow): LoyaltyCustomerFilter | null {
  const kind = kindOf(row.field);
  let candidate: unknown;
  if (kind === 'id') {
    candidate = { field: row.field, operator: 'eq', value: row.value1 };
  } else if (row.operator === 'between') {
    candidate = {
      field: row.field,
      operator: 'between',
      value: kind === 'numeric' ? [row.value1, row.value2] : [row.value1, row.value2],
    };
  } else {
    candidate = { field: row.field, operator: row.operator, value: row.value1 };
  }
  const parsed = loyaltyCustomerFilterSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function ExportPage() {
  const config = useConfig();
  const createExport = useCreateExport();
  const exports = useExports();

  const [rows, setRows] = useState<FilterRow[]>([emptyRow()]);
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Prefill the email from config once loaded.
  const configuredEmail = config.data?.exportEmail ?? '';
  const effectiveEmail = emailTouched ? email : email || configuredEmail;

  const filters: LoyaltyCustomerFilters = useMemo(() => {
    const built = rows.map(rowToFilter).filter((f): f is LoyaltyCustomerFilter => f !== null);
    return built.slice(0, 10);
  }, [rows]);

  const preview = useCustomers(filters, 'points_balance', 1, 5);
  const count = preview.data?.total ?? 0;
  const emailRequired = count > LOYALTY_EXPORT_EMAIL_THRESHOLD;

  const updateRow = (index: number, patch: Partial<FilterRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const changeField = (index: number, field: LoyaltyFilterField) => {
    updateRow(index, { field, operator: operatorsFor(field)[0] ?? 'eq', value1: '', value2: '' });
  };
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (index: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const submit = async () => {
    setSubmitted(true);
    setFieldError(null);
    if (emailRequired && !effectiveEmail.trim()) {
      setFieldError('An email is required for exports over 10,000 rows.');
      return;
    }
    try {
      await createExport.mutateAsync({
        filters,
        ...(effectiveEmail.trim() ? { email: effectiveEmail.trim() } : {}),
      });
      setSubmitted(false);
    } catch (err) {
      if (err instanceof ApiException && err.errorCode === 'EMAIL_REQUIRED') {
        setFieldError('An email is required for exports over 10,000 rows.');
        return;
      }
      setFieldError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const historyColumns = [
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (value ? new Date(value as string).toLocaleString() : '—'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: unknown) => <Tag>{String(value)}</Tag>,
    },
    {
      title: 'Rows',
      dataIndex: 'rowCount',
      key: 'rowCount',
      render: (value: unknown) =>
        value === null || value === undefined ? '—' : Number(value).toLocaleString('en-IN'),
    },
    {
      title: 'Emailed',
      dataIndex: 'emailedAt',
      key: 'emailedAt',
      render: (value: unknown) => (value ? <Tag color="green">emailed</Tag> : '—'),
    },
    {
      title: 'Download',
      dataIndex: 'download',
      key: 'download',
      render: (_value: unknown, record: unknown) => {
        const job = record as ExportJob;
        return (
          <Button
            size="small"
            disabled={job.status !== 'done'}
            onClick={() =>
              void downloadAuthenticated(`/api/exports/${job.id}/download`, `export-${job.id}.csv`)
            }
          >
            Download CSV
          </Button>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 0 }}>
          Export customers
        </Typography.Title>
        <Typography.Text type="secondary">
          Filter the customer mirror (conditions are AND-joined) and export a CSV — large exports
          are emailed a download link.
        </Typography.Text>
      </div>

      <Card title="Filters">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          {rows.map((row, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: filter rows have no stable identity
              key={index}
              data-testid="filter-row"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <select
                aria-label="Filter field"
                value={row.field}
                onChange={(e) => changeField(index, e.target.value as LoyaltyFilterField)}
                style={{ padding: '4px 8px' }}
              >
                {LOYALTY_FILTER_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABELS[field]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter operator"
                value={row.operator}
                onChange={(e) => updateRow(index, { operator: e.target.value })}
                style={{ padding: '4px 8px' }}
              >
                {operatorsFor(row.field).map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABELS[op] ?? op}
                  </option>
                ))}
              </select>

              <input
                type={
                  kindOf(row.field) === 'date'
                    ? 'date'
                    : kindOf(row.field) === 'numeric'
                      ? 'number'
                      : 'text'
                }
                aria-label="Filter value"
                value={row.value1}
                onChange={(e) => updateRow(index, { value1: e.target.value })}
                style={{ padding: '4px 8px', width: 160 }}
              />
              {row.operator === 'between' && (
                <>
                  <Typography.Text type="secondary">and</Typography.Text>
                  <input
                    type={kindOf(row.field) === 'date' ? 'date' : 'number'}
                    aria-label="Filter value max"
                    value={row.value2}
                    onChange={(e) => updateRow(index, { value2: e.target.value })}
                    style={{ padding: '4px 8px', width: 160 }}
                  />
                </>
              )}

              <Button size="small" aria-label="Remove filter" onClick={() => removeRow(index)}>
                ✕
              </Button>
            </div>
          ))}
          <div>
            <Button size="small" onClick={addRow} disabled={rows.length >= 10}>
              + Add filter
            </Button>
          </div>
        </Space>
      </Card>

      <Card title="Preview" loading={preview.isLoading}>
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Typography.Text data-testid="preview-count">
            Matching customers:{' '}
            <Typography.Text strong>{count.toLocaleString('en-IN')}</Typography.Text>
          </Typography.Text>

          <Table
            rowKey="phone"
            columns={[
              { title: 'Phone', dataIndex: 'phone', key: 'phone' },
              {
                title: 'Name',
                dataIndex: 'name',
                key: 'name',
                render: (value: unknown) => (value ? String(value) : '—'),
              },
              {
                title: 'Coins',
                dataIndex: 'pointsBalance',
                key: 'pointsBalance',
                render: (value: unknown) => Number(value).toLocaleString('en-IN'),
              },
              {
                title: 'Lifetime earned',
                dataIndex: 'lifetimeEarned',
                key: 'lifetimeEarned',
                render: (value: unknown) => Number(value).toLocaleString('en-IN'),
              },
            ]}
            dataSource={preview.data?.rows ?? []}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No customers match these filters" /> }}
          />

          {emailRequired && (
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
                Email (required for exports over 10,000 rows)
              </Typography.Text>
              <Input
                aria-label="Export email"
                placeholder="ops@example.com"
                value={effectiveEmail}
                onChange={(e) => {
                  setEmailTouched(true);
                  setEmail(e.target.value);
                }}
                {...(submitted && emailRequired && !effectiveEmail.trim()
                  ? { status: 'error' as const }
                  : {})}
              />
            </div>
          )}

          {fieldError && <Alert type="error" showIcon message={fieldError} />}

          <div>
            <PrimaryButton onClick={() => void submit()} loading={createExport.isPending}>
              Start export
            </PrimaryButton>
          </div>
        </Space>
      </Card>

      <Card title="Recent exports">
        <Table
          rowKey="id"
          columns={historyColumns}
          dataSource={exports.data?.items ?? []}
          loading={exports.isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No exports yet" /> }}
        />
      </Card>
    </Space>
  );
}
