import {
  Alert,
  ArrowLeftOutlined,
  Button,
  Card,
  DownloadOutlined,
  Empty,
  message,
  Pagination,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from '@/hooks/useForms';
import {
  type DeliveryRow,
  downloadSubmissionsCsv,
  type SubmissionListItem,
  useDeliveries,
  useRetriggerDelivery,
  useSubmissionDetail,
  useSubmissions,
} from '@/hooks/useSubmissions';

export const Route = createFileRoute('/submissions/$formId')({
  component: SubmissionsRoute,
});

function SubmissionsRoute() {
  const { formId } = Route.useParams();
  return <SubmissionsScreen formId={formId} />;
}

const DELIVERY_STATUS_COLOR: Record<DeliveryRow['status'], string> = {
  pending: 'blue',
  delivered: 'green',
  failed: 'red',
};

export function SubmissionsScreen({ formId }: { formId: string }) {
  const form = useForm(formId);
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadSubmissionsCsv(formId);
    } catch (err) {
      void message.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/" aria-label="Back to forms">
          <Button type="text" icon={<ArrowLeftOutlined />} />
        </Link>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {form.data ? `Submissions — ${form.data.name}` : 'Submissions'}
          </Typography.Title>
        </div>
        <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void onExport()}>
          Export CSV
        </Button>
      </div>

      <Tabs
        defaultActiveKey="submissions"
        items={[
          {
            key: 'submissions',
            label: 'Submissions',
            children: <SubmissionsTable formId={formId} />,
          },
          {
            key: 'deliveries',
            label: 'Webhook deliveries',
            children: <DeliveriesTable formId={formId} />,
          },
        ]}
      />
    </Space>
  );
}

function previewValues(data: Record<string, unknown>): string {
  return Object.entries(data)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(' · ');
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined) return '—';
  return String(value);
}

function SubmissionsTable({ formId }: { formId: string }) {
  const [page, setPage] = useState(1);
  const submissions = useSubmissions(formId, page);
  const rows = submissions.data?.submissions ?? [];

  const columns = [
    {
      title: 'Submitted',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (
        <Typography.Text>{new Date(value as string).toLocaleString()}</Typography.Text>
      ),
    },
    {
      title: 'Preview',
      dataIndex: 'id',
      key: 'preview',
      render: (_v: unknown, record: unknown) => {
        const row = record as SubmissionListItem;
        return (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {previewValues(row.data) || '—'}
          </Typography.Text>
        );
      },
    },
  ];

  return (
    <Card>
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={submissions.isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No submissions yet" /> }}
          expandable={{
            // Detail (incl. signed file URLs) is fetched lazily on expand.
            expandedRowRender: (record) => (
              <SubmissionDetailPanel submissionId={(record as SubmissionListItem).id} />
            ),
          }}
        />
        <div style={{ textAlign: 'right' }}>
          <Pagination
            current={page}
            pageSize={20}
            total={(page - (submissions.data?.hasMore ? 0 : 1)) * 20 + rows.length}
            onChange={(p) => setPage(p)}
          />
        </div>
      </Space>
    </Card>
  );
}

function SubmissionDetailPanel({ submissionId }: { submissionId: string }) {
  const detail = useSubmissionDetail(submissionId);
  if (detail.isLoading) return <Spin size="small" />;
  if (detail.isError || !detail.data) {
    return <Alert type="error" showIcon message="Could not load this submission." />;
  }
  const { data, files, fileUrls } = detail.data;
  return (
    <Space direction="vertical" size={8} style={{ display: 'flex' }}>
      {Object.entries(data).map(([key, value]) => (
        <div key={key} style={{ display: 'flex', gap: 8 }}>
          <Typography.Text strong style={{ minWidth: 140 }}>
            {key}
          </Typography.Text>
          <Typography.Text>{formatValue(value)}</Typography.Text>
        </div>
      ))}
      {Object.keys(files).map((key) => (
        <div key={key} style={{ display: 'flex', gap: 8 }}>
          <Typography.Text strong style={{ minWidth: 140 }}>
            {key}
          </Typography.Text>
          {fileUrls[key] ? (
            <a href={fileUrls[key]} target="_blank" rel="noreferrer">
              Download file
            </a>
          ) : (
            <Typography.Text type="secondary">file unavailable</Typography.Text>
          )}
        </div>
      ))}
    </Space>
  );
}

function DeliveriesTable({ formId }: { formId: string }) {
  const [page, setPage] = useState(1);
  const deliveries = useDeliveries(formId, page);
  const retrigger = useRetriggerDelivery(formId);
  const rows = deliveries.data?.deliveries ?? [];

  const columns = [
    {
      title: 'Submission',
      dataIndex: 'submissionId',
      key: 'submissionId',
      render: (value: unknown) => (
        <Typography.Text code style={{ fontSize: 12 }}>
          {value as string}
        </Typography.Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (_v: unknown, record: unknown) => {
        const row = record as DeliveryRow;
        return (
          <Space size={6}>
            <Tag color={DELIVERY_STATUS_COLOR[row.status]}>{row.status}</Tag>
            {row.lastStatusCode !== null && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                HTTP {row.lastStatusCode}
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Attempts',
      dataIndex: 'attempts',
      key: 'attempts',
    },
    {
      title: 'When',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: unknown) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {new Date(value as string).toLocaleString()}
        </Typography.Text>
      ),
    },
    {
      title: '',
      dataIndex: 'id',
      key: 'actions',
      render: (_v: unknown, record: unknown) => {
        const row = record as DeliveryRow;
        if (row.status !== 'failed') return <span />;
        return (
          <Button
            size="small"
            loading={retrigger.isPending && retrigger.variables === row.id}
            onClick={() =>
              retrigger.mutate(row.id, {
                onSuccess: () => void message.success('Delivery re-queued'),
              })
            }
          >
            Retry
          </Button>
        );
      },
    },
  ];

  return (
    <Card>
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        {retrigger.error && (
          <Alert type="error" showIcon message={(retrigger.error as Error).message} />
        )}
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={deliveries.isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: <Empty description="No webhook deliveries for this form" /> }}
        />
        <div style={{ textAlign: 'right' }}>
          <Pagination
            current={page}
            pageSize={20}
            total={(page - (deliveries.data?.hasMore ? 0 : 1)) * 20 + rows.length}
            onChange={(p) => setPage(p)}
          />
        </div>
      </Space>
    </Card>
  );
}
