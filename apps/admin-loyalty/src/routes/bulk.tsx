import {
  Alert,
  Button,
  Card,
  Empty,
  Pagination,
  PrimaryButton,
  Progress,
  RadioGroup,
  Space,
  Table,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type BulkOperation,
  useBulkOp,
  useBulkOps,
  useConfirmBulkOp,
  useCreateBulkOp,
  useIngestRows,
} from '@/hooks/useLoyalty';
import { downloadAuthenticated, downloadTextFile } from '@/lib/download';
import { type BulkCsvParseResult, parseBulkCsv, toCsv } from '@/lib/parse-csv';

export const Route = createFileRoute('/bulk')({ component: BulkPage });

/** Server ingest cap per POST /bulk-operations/:id/rows call (TRD §2). */
const INGEST_CHUNK_SIZE = 2000;

const STATUS_COLOR: Record<string, string> = {
  validating: 'blue',
  awaiting_confirm: 'gold',
  processing: 'blue',
  done: 'green',
  failed: 'red',
};

export function BulkPage() {
  const [opType, setOpType] = useState<'credit' | 'debit'>('credit');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<BulkCsvParseResult | null>(null);
  const [activeOpId, setActiveOpId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const createOp = useCreateBulkOp();
  const ingest = useIngestRows();
  const confirm = useConfirmBulkOp();
  const activeOp = useBulkOp(activeOpId);
  const history = useBulkOps(historyPage, 10);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setActiveOpId(null);
    setSubmitError(null);
    setParsed(parseBulkCsv(await file.text()));
  };

  const downloadInvalidRows = () => {
    if (!parsed) return;
    const csv = toCsv([
      ['row_number', 'raw', 'error'],
      ...parsed.invalid.map((row) => [String(row.rowNumber), row.raw, row.error]),
    ]);
    downloadTextFile(csv, 'invalid-rows.csv');
  };

  const handleConfirm = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createOp.mutateAsync({
        type: opType,
        ...(fileName ? { fileName } : {}),
        totalRows: parsed.rows.length,
      });
      for (let i = 0; i < parsed.rows.length; i += INGEST_CHUNK_SIZE) {
        await ingest.mutateAsync({
          id: created.id,
          rows: parsed.rows.slice(i, i + INGEST_CHUNK_SIZE),
        });
      }
      await confirm.mutateAsync(created.id);
      setActiveOpId(created.id);
      setParsed(null);
      setFileName(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Bulk operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 0 }}>
          Bulk operations
        </Typography.Title>
        <Typography.Text type="secondary">
          Credit or debit coins for up to 50,000 customers from a CSV (columns: phone_number,
          amount, reason).
        </Typography.Text>
      </div>

      <Card title="New bulk operation">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <RadioGroup
            value={opType}
            onChange={(e) => setOpType(e.target.value as 'credit' | 'debit')}
            options={[
              { label: 'Credit coins', value: 'credit' },
              { label: 'Debit coins', value: 'debit' },
            ]}
          />
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />

          {parsed && (
            <Card size="small" title={`Preview${fileName ? ` — ${fileName}` : ''}`}>
              <Space direction="vertical" size="small" style={{ display: 'flex' }}>
                <Typography.Text>
                  Valid rows: <Typography.Text strong>{parsed.rows.length}</Typography.Text> ·
                  Invalid rows: <Typography.Text strong>{parsed.invalid.length}</Typography.Text> ·
                  Total coins to {opType}:{' '}
                  <Typography.Text strong>
                    {parsed.totalPoints.toLocaleString('en-IN')}
                  </Typography.Text>
                </Typography.Text>

                {parsed.duplicateCount > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    message={`${parsed.duplicateCount} duplicate phone number${
                      parsed.duplicateCount === 1 ? '' : 's'
                    } — the last row wins`}
                  />
                )}

                {parsed.invalid.length > 0 && (
                  <Button onClick={downloadInvalidRows}>Download invalid rows CSV</Button>
                )}

                {submitError && <Alert type="error" showIcon message={submitError} />}

                <div>
                  <PrimaryButton
                    onClick={() => void handleConfirm()}
                    loading={submitting}
                    disabled={parsed.rows.length === 0 || submitting}
                  >
                    Confirm {opType} of {parsed.totalPoints.toLocaleString('en-IN')} coins
                  </PrimaryButton>
                </div>
              </Space>
            </Card>
          )}
        </Space>
      </Card>

      {activeOpId && activeOp.data && <ProgressPanel op={activeOp.data} />}

      <Card title="History">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Table
            rowKey="id"
            columns={historyColumns}
            dataSource={history.data?.items ?? []}
            loading={history.isLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No bulk operations yet" /> }}
          />
          <div style={{ textAlign: 'right' }}>
            <Pagination
              current={historyPage}
              pageSize={10}
              total={history.data?.total ?? 0}
              onChange={(p) => setHistoryPage(p)}
            />
          </div>
        </Space>
      </Card>
    </Space>
  );
}

function ProgressPanel({ op }: { op: BulkOperation }) {
  const total = op.validRows || op.totalRows;
  const percent = total > 0 ? Math.round((op.processedRows / total) * 100) : 0;
  const running = op.status === 'processing' || op.status === 'validating';
  return (
    <Card title="Operation progress">
      <Space direction="vertical" size="small" style={{ display: 'flex' }}>
        <Typography.Text>
          Status: <Tag color={STATUS_COLOR[op.status] ?? 'default'}>{op.status}</Tag>
        </Typography.Text>
        <Typography.Text data-testid="bulk-progress">
          {op.processedRows} / {total} rows processed · {op.successCount} succeeded ·{' '}
          {op.failureCount} failed
        </Typography.Text>
        <Progress
          percent={op.status === 'done' ? 100 : percent}
          {...(running ? { status: 'active' as const } : {})}
        />
        {op.failureCount > 0 && (
          <Button
            onClick={() =>
              void downloadAuthenticated(
                `/api/bulk-operations/${op.id}/errors.csv`,
                `bulk-${op.id}-errors.csv`,
              )
            }
          >
            Download failed rows CSV
          </Button>
        )}
      </Space>
    </Card>
  );
}

const historyColumns = [
  {
    title: 'Created',
    dataIndex: 'createdAt',
    key: 'createdAt',
    render: (value: unknown) => (value ? new Date(value as string).toLocaleString() : '—'),
  },
  { title: 'Type', dataIndex: 'type', key: 'type' },
  {
    title: 'File',
    dataIndex: 'fileName',
    key: 'fileName',
    render: (v: unknown) => (v as string) || '—',
  },
  {
    title: 'Status',
    dataIndex: 'status',
    key: 'status',
    render: (value: unknown) => (
      <Tag color={STATUS_COLOR[value as string] ?? 'default'}>{value as string}</Tag>
    ),
  },
  {
    title: 'Rows',
    dataIndex: 'rows',
    key: 'rows',
    render: (_value: unknown, record: unknown) => {
      const op = record as BulkOperation;
      return `${op.successCount} ok / ${op.failureCount} failed of ${op.validRows}`;
    },
  },
  {
    title: 'Errors',
    dataIndex: 'errors',
    key: 'errors',
    render: (_value: unknown, record: unknown) => {
      const op = record as BulkOperation;
      if (op.failureCount === 0 && op.invalidRows === 0) return '—';
      return (
        <Button
          size="small"
          onClick={() =>
            void downloadAuthenticated(
              `/api/bulk-operations/${op.id}/errors.csv`,
              `bulk-${op.id}-errors.csv`,
            )
          }
        >
          errors.csv
        </Button>
      );
    },
  },
];
