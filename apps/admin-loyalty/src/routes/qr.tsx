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
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type QrCode,
  type QrDetail,
  type QrPayload,
  type QrScan,
  type QrState,
  useCreateQr,
  useQrCode,
  useQrCodes,
  useQrScans,
  useSetQrStatus,
  useUpdateQr,
} from '@/hooks/useLoyalty';
import { downloadAuthenticated } from '@/lib/download';

export const Route = createFileRoute('/qr')({ component: QrPage });

const STATE_COLOR: Record<QrState, string> = {
  active: 'green',
  not_started: 'blue',
  expired: 'red',
  paused: 'gold',
  fully_claimed: 'purple',
};

const POSTER_SIZES = [300, 600, 1200] as const;

interface QrFormState {
  eventName: string;
  pointsPerScan: string;
  maxScans: string;
  startsAt: string;
  expiresAt: string;
  claimMessage: string;
}

function emptyForm(): QrFormState {
  const now = new Date();
  const later = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  return {
    eventName: '',
    pointsPerScan: '100',
    maxScans: '0',
    startsAt: toLocalInput(now.toISOString()),
    expiresAt: toLocalInput(later.toISOString()),
    claimMessage: '',
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

function formFromQr(qr: QrCode): QrFormState {
  return {
    eventName: qr.eventName,
    pointsPerScan: String(qr.pointsPerScan),
    maxScans: String(qr.maxScans),
    startsAt: toLocalInput(qr.startsAt),
    expiresAt: toLocalInput(qr.expiresAt),
    claimMessage: qr.claimMessage ?? '',
  };
}

/** Client-side mask — the admin never needs the full scanning phone. */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

function validate(form: QrFormState): string[] {
  const errors: string[] = [];
  if (!form.eventName.trim()) errors.push('Event name is required.');
  const points = Number(form.pointsPerScan);
  if (!Number.isFinite(points) || points < 1) errors.push('Coins per scan must be at least 1.');
  const max = Number(form.maxScans);
  if (!Number.isInteger(max) || max < 0) errors.push('Max scans must be 0 (unlimited) or more.');
  if (!form.startsAt) errors.push('Start date is required.');
  if (!form.expiresAt) errors.push('Expiry date is required.');
  if (form.startsAt && form.expiresAt && form.startsAt >= form.expiresAt) {
    errors.push('Expiry must be after the start date.');
  }
  return errors;
}

export function QrPage() {
  const qrCodes = useQrCodes();
  const createQr = useCreateQr();
  const updateQr = useUpdateQr();
  const setStatus = useSetQrStatus();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<QrFormState>(emptyForm());
  const [errors, setErrors] = useState<string[]>([]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setErrors([]);
    setFormOpen(true);
  };
  const openEdit = (qr: QrCode) => {
    setEditingId(qr.id);
    setForm(formFromQr(qr));
    setErrors([]);
    setFormOpen(true);
  };

  const submit = async () => {
    const found = validate(form);
    if (found.length > 0) {
      setErrors(found);
      return;
    }
    setErrors([]);
    const payload: QrPayload = {
      eventName: form.eventName.trim(),
      pointsPerScan: Number(form.pointsPerScan),
      maxScans: Number(form.maxScans),
      startsAt: new Date(form.startsAt).toISOString(),
      expiresAt: new Date(form.expiresAt).toISOString(),
      ...(form.claimMessage.trim() ? { claimMessage: form.claimMessage.trim() } : {}),
    };
    try {
      if (editingId) {
        await updateQr.mutateAsync({ id: editingId, input: payload });
        setSelectedId(editingId);
      } else {
        const created = await createQr.mutateAsync(payload);
        setSelectedId(created.id);
      }
      setFormOpen(false);
      setEditingId(null);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Save failed']);
    }
  };

  const columns = [
    { title: 'Event', dataIndex: 'eventName', key: 'eventName' },
    {
      title: 'Coins/scan',
      dataIndex: 'pointsPerScan',
      key: 'pointsPerScan',
      render: (value: unknown) => Number(value).toLocaleString('en-IN'),
    },
    {
      title: 'Scans',
      dataIndex: 'scanCount',
      key: 'scanCount',
      render: (_value: unknown, record: unknown) => {
        const qr = record as QrCode;
        return `${qr.scanCount.toLocaleString('en-IN')} / ${
          qr.maxScans === 0 ? '∞' : qr.maxScans.toLocaleString('en-IN')
        }`;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value: unknown) => <Tag>{String(value)}</Tag>,
    },
    {
      title: 'State',
      dataIndex: 'state',
      key: 'state',
      render: (value: unknown) => (
        <Tag color={STATE_COLOR[value as QrState] ?? 'default'}>{String(value)}</Tag>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'actions',
      key: 'actions',
      render: (_value: unknown, record: unknown) => {
        const qr = record as QrCode;
        const canPause = qr.status === 'ACTIVE';
        const canActivate = qr.status === 'PAUSED' || qr.status === 'DRAFT';
        return (
          <Space>
            <Button size="small" onClick={() => setSelectedId(qr.id)}>
              View
            </Button>
            <Button size="small" onClick={() => openEdit(qr)}>
              Edit
            </Button>
            {canPause && (
              <Button
                size="small"
                onClick={() => setStatus.mutate({ id: qr.id, status: 'PAUSED' })}
              >
                Pause
              </Button>
            )}
            {canActivate && (
              <Button
                size="small"
                onClick={() => setStatus.mutate({ id: qr.id, status: 'ACTIVE' })}
              >
                Activate
              </Button>
            )}
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
            QR codes
          </Typography.Title>
          <Typography.Text type="secondary">
            Offline scan-to-earn campaigns — one scan per phone, printable posters, and a copy-paste
            storefront loader.
          </Typography.Text>
        </div>
        <PrimaryButton onClick={openCreate}>New QR code</PrimaryButton>
      </div>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={qrCodes.data ?? []}
          loading={qrCodes.isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No QR campaigns yet" /> }}
        />
      </Card>

      {formOpen && (
        <Card title={editingId ? 'Edit QR code' : 'New QR code'}>
          <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
            <FieldRow label="Event name">
              <Input
                placeholder="Diwali Expo 2026"
                value={form.eventName}
                onChange={(e) => setForm({ ...form, eventName: e.target.value })}
              />
            </FieldRow>

            <Space wrap size="large">
              <FieldRow label="Coins per scan">
                <input
                  type="number"
                  aria-label="Coins per scan"
                  value={form.pointsPerScan}
                  min={1}
                  onChange={(e) => setForm({ ...form, pointsPerScan: e.target.value })}
                  style={{ padding: '4px 8px', width: 140 }}
                />
              </FieldRow>
              <FieldRow label="Max scans (0 = unlimited)">
                <input
                  type="number"
                  aria-label="Max scans"
                  value={form.maxScans}
                  min={0}
                  onChange={(e) => setForm({ ...form, maxScans: e.target.value })}
                  style={{ padding: '4px 8px', width: 160 }}
                />
              </FieldRow>
            </Space>

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
              <FieldRow label="Expires at">
                <input
                  type="datetime-local"
                  aria-label="Expires at"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  style={{ padding: '4px 8px' }}
                />
              </FieldRow>
            </Space>

            <FieldRow label="Claim message (optional)">
              <Input
                placeholder="Thanks for visiting our booth — here are your coins!"
                value={form.claimMessage}
                onChange={(e) => setForm({ ...form, claimMessage: e.target.value })}
              />
            </FieldRow>

            {errors.length > 0 && (
              <Alert
                type="error"
                showIcon
                message="QR code is invalid"
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
                loading={createQr.isPending || updateQr.isPending}
              >
                {editingId ? 'Save QR code' : 'Create QR code'}
              </PrimaryButton>
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            </Space>
          </Space>
        </Card>
      )}

      {selectedId && <QrDetailPanel id={selectedId} />}
    </Space>
  );
}

function QrDetailPanel({ id }: { id: string }) {
  const detail = useQrCode(id);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(label);
    } catch {
      setCopied(null);
    }
  };

  if (detail.isLoading) return <Card loading title="QR detail" />;
  if (!detail.data) return <Empty description="QR code not found" />;
  const qr: QrDetail = detail.data;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Card
        title={`QR detail — ${qr.eventName}`}
        extra={<Tag color={STATE_COLOR[qr.state] ?? 'default'}>{qr.state}</Tag>}
      >
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            <Stat title="Coins per scan" value={qr.pointsPerScan} />
            <Stat title="Scans" value={qr.scanCount} />
            <Stat title="New-to-loyalty phones" value={qr.newPhoneCount} />
            <Stat title="Max scans" value={qr.maxScans === 0 ? '∞' : qr.maxScans} />
          </div>

          <FieldRow label="Claim URL">
            {qr.claimUrl ? (
              <Space wrap>
                <Typography.Text code style={{ wordBreak: 'break-all' }}>
                  {qr.claimUrl}
                </Typography.Text>
                <Button size="small" onClick={() => void copy(qr.claimUrl ?? '', 'claim URL')}>
                  Copy
                </Button>
              </Space>
            ) : (
              <Alert
                type="warning"
                showIcon
                message="Set the storefront base URL in Settings to mint the claim link."
              />
            )}
          </FieldRow>

          <FieldRow label="Storefront loader snippet">
            <Typography.Paragraph copyable={{ text: qr.loaderSnippet }}>
              <Typography.Text code style={{ wordBreak: 'break-all' }}>
                {qr.loaderSnippet}
              </Typography.Text>
            </Typography.Paragraph>
          </FieldRow>

          <FieldRow label="Printable poster">
            <Space wrap>
              {POSTER_SIZES.map((size) => (
                <Button
                  key={size}
                  onClick={() =>
                    void downloadAuthenticated(
                      `/api/qr-codes/${qr.id}/poster.png?size=${size}`,
                      `qr-${qr.code}-${size}.png`,
                    )
                  }
                >
                  PNG {size}px
                </Button>
              ))}
              <Button
                onClick={() =>
                  void downloadAuthenticated(
                    `/api/qr-codes/${qr.id}/poster.pdf`,
                    `qr-${qr.code}.pdf`,
                  )
                }
              >
                PDF
              </Button>
            </Space>
          </FieldRow>

          {copied && <Alert type="success" showIcon message={`Copied ${copied} to clipboard.`} />}
        </Space>
      </Card>

      <ScanList id={qr.id} />
    </Space>
  );
}

function ScanList({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const scans = useQrScans(id, page);

  const columns = [
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      render: (value: unknown) => maskPhone(String(value)),
    },
    {
      title: 'New phone',
      dataIndex: 'isNewPhone',
      key: 'isNewPhone',
      render: (value: unknown) =>
        value === true || value === 1 ? <Tag color="green">new</Tag> : '—',
    },
    {
      title: 'Converted order',
      dataIndex: 'convertedOrderId',
      key: 'convertedOrderId',
      render: (value: unknown) => (value ? String(value) : '—'),
    },
    {
      title: 'Scanned at',
      dataIndex: 'scannedAt',
      key: 'scannedAt',
      render: (value: unknown) => (value ? new Date(value as string).toLocaleString() : '—'),
    },
  ];

  return (
    <Card title="Recent scans">
      <Table
        rowKey={(row) => String((row as QrScan).id)}
        columns={columns}
        dataSource={scans.data?.rows ?? []}
        loading={scans.isLoading}
        pagination={{
          current: page,
          pageSize: scans.data?.limit ?? 20,
          total: scans.data?.total ?? 0,
          onChange: (p) => setPage(p),
        }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <Empty description="No scans yet" /> }}
      />
    </Card>
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
