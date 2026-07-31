import {
  Alert,
  Card,
  Empty,
  Input,
  Modal,
  PrimaryButton,
  RadioGroup,
  Space,
  Table,
  Tabs,
  Typography,
} from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { FieldRow } from '@/components/FieldRow';
import {
  type CustomerProfile,
  type CustomerRow,
  type CustomerSort,
  useAdjustCustomer,
  useCustomerProfile,
  useCustomers,
} from '@/hooks/useLoyalty';
import { ApiException } from '@/lib/api';
import { normalizeBulkPhone } from '@/lib/parse-csv';

export const Route = createFileRoute('/customers')({ component: CustomersPage });

const MIN_POINTS = 1;
const MAX_POINTS = 100_000;
const INVALID_PHONE_MESSAGE = 'Enter a valid Indian mobile number — 10 digits starting 6-9.';

export function CustomersPage() {
  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 0 }}>
          Customers
        </Typography.Title>
        <Typography.Text type="secondary">
          Look up a customer by phone or browse the coins leaderboard.
        </Typography.Text>
      </div>

      <Tabs
        defaultActiveKey="search"
        items={[
          { key: 'search', label: 'Search', children: <CustomerSearch /> },
          { key: 'leaderboard', label: 'Leaderboard', children: <Leaderboard /> },
        ]}
      />
    </Space>
  );
}

function CustomerSearch() {
  const [query, setQuery] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const profile = useCustomerProfile(phone);

  const search = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchError('Enter a phone number to search.');
      setPhone(null);
      return;
    }
    // Normalize before the request so `9876543210`, `+91 98765 43210` and
    // `09876543210` all resolve to the one customer the backend stores.
    const normalized = normalizeBulkPhone(trimmed);
    if (!normalized) {
      setSearchError(INVALID_PHONE_MESSAGE);
      setPhone(null);
      return;
    }
    setSearchError(undefined);
    setPhone(normalized);
  };

  const notFound =
    profile.isError &&
    profile.error instanceof ApiException &&
    profile.error.errorCode === 'CUSTOMER_NOT_FOUND';

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Card>
        <FieldRow label="Phone number" required error={searchError}>
          <Space wrap>
            <Input
              aria-label="Search phone"
              placeholder="9876543210"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={search}
              style={{ width: 240 }}
              {...(searchError ? { status: 'error' as const } : {})}
            />
            <PrimaryButton onClick={search}>Search</PrimaryButton>
          </Space>
        </FieldRow>
      </Card>

      {phone && profile.isLoading && <Card loading title="Customer" />}
      {phone && notFound && <UnknownCustomerCard phone={phone} />}
      {phone && profile.isError && !notFound && (
        <Alert
          type="error"
          showIcon
          message={profile.error instanceof Error ? profile.error.message : 'Customer not found'}
        />
      )}
      {phone && profile.data && <ProfileCard phone={phone} data={profile.data} />}
    </Space>
  );
}

/**
 * A phone with no mirror row — never ordered, never scanned a QR, never in a
 * bulk op. This used to be a dead end: a bare "customer not found" error with
 * no way to give them coins, even though the adjust endpoint accepts any valid
 * phone. Adjusting here creates the mirror row (firstSeenSource 'manual'), so
 * the next search finds them.
 */
function UnknownCustomerCard({ phone }: { phone: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Card title="Not in your loyalty program yet">
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Typography.Text type="secondary">
          {phone} has no orders, QR scans or bulk adjustments yet. You can still credit or debit
          coins — doing so adds them to your customer list.
        </Typography.Text>
        <div>
          <PrimaryButton onClick={() => setDialogOpen(true)}>Credit or debit coins</PrimaryButton>
        </div>
        <AdjustDialog phone={phone} open={dialogOpen} onClose={() => setDialogOpen(false)} />
      </Space>
    </Card>
  );
}

function ProfileCard({ phone, data }: { phone: string; data: CustomerProfile }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { profile, balance, history } = data;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Card
        title={profile.name || phone}
        extra={<PrimaryButton onClick={() => setDialogOpen(true)}>Adjust coins</PrimaryButton>}
      >
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Typography.Text type="secondary">
            {phone}
            {profile.email ? ` · ${profile.email}` : ''}
          </Typography.Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 12,
            }}
          >
            <Stat title="Coins balance (mirror)" value={profile.pointsBalance} />
            <Stat title="Coins balance (live Core)" value={balance.points_balance} />
            <Stat title="Lifetime earned" value={profile.lifetimeEarned} />
            <Stat title="Lifetime redeemed" value={profile.lifetimeRedeemed} />
            <Stat title="Lifetime spend (₹)" value={Number(profile.lifetimeSpend)} />
            <Stat title="Lifetime orders" value={profile.lifetimeOrders} />
            <Stat
              title="Last order"
              value={profile.lastOrderAt ? new Date(profile.lastOrderAt).toLocaleDateString() : '—'}
            />
          </div>
        </Space>
      </Card>

      <Card title="Recent activity">
        {history.items.length === 0 ? (
          <Empty description="No coin activity yet" />
        ) : (
          <Space direction="vertical" size="small" style={{ display: 'flex' }}>
            {history.items.map((item, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: history rows have no stable client id
                key={index}
                data-testid="history-item"
                style={{ borderBottom: '1px solid #f0f0f0', paddingBottom: 4 }}
              >
                <Typography.Text code style={{ fontSize: 12 }}>
                  {JSON.stringify(item)}
                </Typography.Text>
              </div>
            ))}
          </Space>
        )}
      </Card>

      <AdjustDialog phone={phone} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Space>
  );
}

function AdjustDialog({
  phone,
  open,
  onClose,
}: {
  phone: string;
  open: boolean;
  onClose: () => void;
}) {
  const adjust = useAdjustCustomer();
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [points, setPoints] = useState('100');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ points?: string; reason?: string }>({});
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    // Each rule reports against its own field rather than into one shared
    // banner, and every failing field is reported at once.
    const next: { points?: string; reason?: string } = {};
    const trimmedPoints = points.trim();
    const amount = Number(trimmedPoints);
    if (!trimmedPoints) next.points = 'Points are required.';
    else if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      next.points = 'Points must be a whole number.';
    } else if (amount < MIN_POINTS || amount > MAX_POINTS) {
      next.points = `Points must be between ${MIN_POINTS} and ${MAX_POINTS.toLocaleString('en-IN')}.`;
    }
    if (!reason.trim()) next.reason = 'A reason is required.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      await adjust.mutateAsync({
        phone,
        input: { direction, points: amount, reason: reason.trim() },
      });
      onClose();
      setReason('');
    } catch (err) {
      if (err instanceof ApiException && err.errorCode === 'INSUFFICIENT_BALANCE') {
        setErrors({ points: 'Insufficient balance — the debit exceeds the customer’s coins.' });
        return;
      }
      setError(err instanceof Error ? err.message : 'Adjustment failed');
    }
  };

  return (
    <Modal
      open={open}
      title="Manual coin adjustment"
      onCancel={onClose}
      okText="Apply"
      confirmLoading={adjust.isPending}
      onOk={() => void submit()}
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <FieldRow label="Direction" required>
          <RadioGroup
            value={direction}
            onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}
            options={[
              { label: 'Credit', value: 'credit' },
              { label: 'Debit', value: 'debit' },
            ]}
          />
        </FieldRow>
        <FieldRow label="Points" required error={errors.points}>
          <input
            type="number"
            aria-label="Adjustment points"
            value={points}
            min={1}
            onChange={(e) => setPoints(e.target.value)}
            style={{ padding: '4px 8px', width: 160 }}
          />
        </FieldRow>
        <FieldRow
          label="Reason"
          required
          error={errors.reason}
          hint="Shown on the customer's coin history"
        >
          <Input
            aria-label="Adjustment reason"
            placeholder="Goodwill credit"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            {...(errors.reason ? { status: 'error' as const } : {})}
          />
        </FieldRow>
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Modal>
  );
}

function Leaderboard() {
  const [sort, setSort] = useState<CustomerSort>('points_balance');
  const [page, setPage] = useState(1);
  const customers = useCustomers([], sort, page, 20);

  const columns = [
    {
      title: 'Rank',
      dataIndex: 'rank',
      key: 'rank',
      render: (_value: unknown, _record: unknown, index: number) => (page - 1) * 20 + index + 1,
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (value: unknown) => (value ? String(value) : '—'),
    },
    {
      title: 'Coins balance',
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
  ];

  return (
    <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
      <Space wrap align="center">
        <Typography.Text strong>Sort by</Typography.Text>
        <RadioGroup
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as CustomerSort);
            setPage(1);
          }}
          options={[
            { label: 'Coins balance', value: 'points_balance' },
            { label: 'Lifetime earned', value: 'lifetime_earned' },
          ]}
        />
      </Space>
      <Card>
        <Table
          rowKey="phone"
          columns={columns}
          dataSource={(customers.data?.rows ?? []) as unknown as CustomerRow[]}
          loading={customers.isLoading}
          pagination={{
            current: page,
            pageSize: 20,
            total: customers.data?.total ?? 0,
            onChange: (p) => setPage(p),
          }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No customers yet" /> }}
        />
      </Card>
    </Space>
  );
}

function Stat({ title, value }: { title: string; value: number | string | undefined }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
        {title}
      </Typography.Text>
      <Typography.Text strong style={{ fontSize: 20 }}>
        {value === undefined
          ? '—'
          : typeof value === 'number'
            ? value.toLocaleString('en-IN')
            : value}
      </Typography.Text>
    </div>
  );
}
