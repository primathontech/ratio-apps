import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
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
import { useEffect, useState } from 'react';
import { FieldRow } from '@/components/FieldRow';
import {
  type BulkOperation,
  isRunningStatus,
  isStalled,
  useAdjustCustomer,
  useBulkOp,
  useBulkOpRows,
  useBulkOps,
  useConfirmBulkOp,
  useCreateBulkOp,
  useIngestRows,
} from '@/hooks/useLoyalty';
import { ApiException } from '@/lib/api';
import { downloadTextFile, fetchAuthenticatedText } from '@/lib/download';
import {
  BULK_CSV_TEMPLATE,
  BULK_CSV_TEMPLATE_FILENAME,
  type BulkCsvParseResult,
  normalizeBulkPhone,
  parseBulkCsv,
  splitCsvLine,
  toCsv,
} from '@/lib/parse-csv';

export const Route = createFileRoute('/bulk')({ component: BulkPage });

/**
 * Rows per `POST /bulk-operations/:id/rows` call.
 *
 * The server caps a chunk at 2,000 rows, but Fastify's global `bodyLimit` is
 * 1 MiB and a row carries a `reason` of up to 500 chars — 2,000 of those
 * serialize to ~1.1 MB and the upload died on an opaque 413. 500 keeps the
 * worst-case chunk near 275 KB, comfortably inside the limit. The extra
 * requests are affordable because bulk ingest has its own rate-limit bucket
 * (see `BULK_INGEST_RE` in the backend's `main.ts`).
 */
const INGEST_CHUNK_SIZE = 500;

/** How many bad rows to show inline before deferring to the CSV download. */
const INVALID_PREVIEW_LIMIT = 10;

/** Page sizes offered by the History "/ page" selector. */
const HISTORY_PAGE_SIZES = ['10', '20', '50', '100'];

const MIN_POINTS = 1;
const MAX_POINTS = 100_000;

const STATUS_COLOR: Record<string, string> = {
  validating: 'blue',
  awaiting_confirm: 'gold',
  processing: 'blue',
  done: 'green',
  failed: 'red',
};

/**
 * The operation status alone hides a partial failure: an upload where 3 of 10
 * rows were rejected still settles on `done` and renders as a green tag the
 * merchant reads as "all good". Surface the mixed outcome explicitly.
 */
function StatusTag({ op }: { op: BulkOperation }) {
  const partial = op.status === 'done' && op.failureCount > 0;
  if (partial) return <Tag color="orange">done with errors</Tag>;
  return <Tag color={STATUS_COLOR[op.status] ?? 'default'}>{op.status}</Tag>;
}

const DELIMITER_LABELS: Record<string, string> = {
  ';': 'semicolon (;)',
  '\t': 'tab',
  '|': 'pipe (|)',
};

type OpType = 'credit' | 'debit';
type Mode = 'csv' | 'manual';

export function BulkPage() {
  const [mode, setMode] = useState<Mode>('csv');
  const [opType, setOpType] = useState<OpType>('credit');
  const [activeOpId, setActiveOpId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [detailOp, setDetailOp] = useState<BulkOperation | null>(null);
  const [errorsCsvOp, setErrorsCsvOp] = useState<BulkOperation | null>(null);

  const activeOp = useBulkOp(activeOpId);
  const history = useBulkOps(historyPage, historyPageSize);

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 0 }}>
          Bulk operations
        </Typography.Title>
        <Typography.Text type="secondary">
          Credit or debit coins for up to 50,000 customers from a CSV — or adjust a single customer
          by hand.
        </Typography.Text>
      </div>

      <Card title="New operation">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <FieldRow label="How do you want to adjust coins?" required>
            <RadioGroup
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              options={[
                { label: 'Upload CSV', value: 'csv' },
                { label: 'Manual entry', value: 'manual' },
              ]}
            />
          </FieldRow>

          <FieldRow label="Direction" required>
            <RadioGroup
              value={opType}
              onChange={(e) => setOpType(e.target.value as OpType)}
              options={[
                { label: 'Credit coins', value: 'credit' },
                { label: 'Debit coins', value: 'debit' },
              ]}
            />
          </FieldRow>

          {mode === 'csv' ? (
            <CsvUploadForm opType={opType} onStarted={setActiveOpId} />
          ) : (
            <ManualAdjustForm opType={opType} />
          )}
        </Space>
      </Card>

      {activeOpId && activeOp.data && (
        <ProgressPanel
          op={activeOp.data}
          onPreviewErrors={setErrorsCsvOp}
          onRefresh={() => {
            void activeOp.refetch();
            void history.refetch();
          }}
        />
      )}

      <Card title="History">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Select an operation to see every customer it credited or debited.
          </Typography.Text>
          <Table
            rowKey="id"
            columns={historyColumns(setErrorsCsvOp)}
            dataSource={history.data?.items ?? []}
            loading={history.isLoading}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No bulk operations yet" /> }}
            onRow={(record) => ({
              onClick: () => setDetailOp(record as BulkOperation),
              style: { cursor: 'pointer' },
            })}
          />
          <div style={{ textAlign: 'right' }}>
            <Pagination
              current={historyPage}
              pageSize={historyPageSize}
              total={history.data?.total ?? 0}
              // `pageSize` is controlled, so without wiring the size change
              // back into state the "/ page" selector rendered but did
              // nothing — it always snapped back to 10.
              showSizeChanger
              pageSizeOptions={HISTORY_PAGE_SIZES}
              onChange={(p, size) => {
                setHistoryPage(p);
                if (size !== historyPageSize) setHistoryPageSize(size);
              }}
              onShowSizeChange={(_current, size) => {
                setHistoryPageSize(size);
                setHistoryPage(1);
              }}
            />
          </div>
        </Space>
      </Card>

      <OperationDetailModal
        op={detailOp}
        onClose={() => setDetailOp(null)}
        onPreviewErrors={setErrorsCsvOp}
      />
      <ErrorsCsvModal op={errorsCsvOp} onClose={() => setErrorsCsvOp(null)} />
    </Space>
  );
}

// ─── CSV upload ─────────────────────────────────────────────────────────────

function CsvUploadForm({ opType, onStarted }: { opType: OpType; onStarted: (id: string) => void }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<BulkCsvParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const createOp = useCreateBulkOp();
  const ingest = useIngestRows();
  const confirm = useConfirmBulkOp();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setSubmitError(null);
    const text = await file.text();
    const result = parseBulkCsv(text);
    setParsed(result);
    // A file that yields nothing usable is the single most common upload
    // failure, and it used to render as an empty preview with no explanation.
    // Name the cause against the field instead.
    if (result.rows.length === 0 && result.invalid.length === 0) {
      setFileError(
        result.headerDetected
          ? 'This file has a header row but no data rows. Add one row per customer below the header.'
          : 'This file is empty. Download the sample CSV to see the expected format.',
      );
    } else if (result.rows.length === 0) {
      setFileError(
        `None of the ${result.invalid.length} row${
          result.invalid.length === 1 ? '' : 's'
        } in this file are valid — see the reasons below. Download the sample CSV if you are unsure of the format.`,
      );
    } else {
      setFileError(null);
    }
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
      onStarted(created.id);
      setParsed(null);
      setFileName(null);
      setFileError(null);
    } catch (err) {
      setSubmitError(describeUploadError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
      <FieldRow
        label="CSV file"
        required
        error={fileError ?? undefined}
        hint="Columns: phone_number, amount, reason (optional). Commas, semicolons and tabs all work."
      >
        <Space wrap>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <Button onClick={() => downloadTextFile(BULK_CSV_TEMPLATE, BULK_CSV_TEMPLATE_FILENAME)}>
            Download sample CSV
          </Button>
        </Space>
      </FieldRow>

      {parsed && (
        <Card size="small" title={`Preview${fileName ? ` — ${fileName}` : ''}`}>
          <Space direction="vertical" size="small" style={{ display: 'flex' }}>
            <Typography.Text>
              Valid rows: <Typography.Text strong>{parsed.rows.length}</Typography.Text> · Invalid
              rows: <Typography.Text strong>{parsed.invalid.length}</Typography.Text> · Total coins
              to {opType}:{' '}
              <Typography.Text strong>{parsed.totalPoints.toLocaleString('en-IN')}</Typography.Text>
            </Typography.Text>

            {DELIMITER_LABELS[parsed.delimiter] && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Detected {DELIMITER_LABELS[parsed.delimiter]} as the column separator.
              </Typography.Text>
            )}

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
              <Space direction="vertical" size="small" style={{ display: 'flex' }}>
                <Table
                  size="small"
                  rowKey="rowNumber"
                  data-testid="invalid-rows"
                  columns={[
                    { title: 'Row', dataIndex: 'rowNumber', key: 'rowNumber', width: 70 },
                    { title: 'Problem', dataIndex: 'error', key: 'error' },
                  ]}
                  dataSource={parsed.invalid.slice(0, INVALID_PREVIEW_LIMIT)}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
                {parsed.invalid.length > INVALID_PREVIEW_LIMIT && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    …and {parsed.invalid.length - INVALID_PREVIEW_LIMIT} more. Download the full
                    list below.
                  </Typography.Text>
                )}
                <div>
                  <Button onClick={downloadInvalidRows}>Download invalid rows CSV</Button>
                </div>
              </Space>
            )}

            {submitError && <Alert type="error" showIcon message={submitError} />}

            {parsed.rows.length > 0 && (
              <div>
                <PrimaryButton
                  onClick={() => void handleConfirm()}
                  loading={submitting}
                  disabled={submitting}
                >
                  Confirm {opType} of {parsed.totalPoints.toLocaleString('en-IN')} coins
                </PrimaryButton>
              </div>
            )}
          </Space>
        </Card>
      )}
    </Space>
  );
}

/**
 * Turn an upload failure into something a merchant can act on. The raw
 * envelope messages for the two limits that actually bite (`RATE_LIMITED` on
 * a very large file, 413 on an oversized chunk) say nothing about the CSV.
 */
function describeUploadError(err: unknown): string {
  if (err instanceof ApiException) {
    if (err.errorCode === 'RATE_LIMITED') {
      return 'Too many requests while uploading. Wait a minute and retry — the rows already accepted are not lost.';
    }
    if (err.status === 413) {
      return 'One chunk of rows was rejected as too large. Shorten the reason column and try again.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Bulk operation failed';
}

// ─── Manual single-customer adjustment ──────────────────────────────────────

interface ManualErrors {
  phone?: string;
  points?: string;
  reason?: string;
}

/**
 * Single-customer credit/debit, sitting beside the CSV flow (QA: merchants
 * need this "in addition to the CSV upload functionality"). It posts to the
 * same `POST /customers/:phone/adjust` endpoint the Customers screen uses, but
 * without requiring a mirror lookup first — so a customer who has never
 * ordered can still be credited.
 */
function ManualAdjustForm({ opType }: { opType: OpType }) {
  const adjust = useAdjustCustomer();
  const [phone, setPhone] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ManualErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const validate = (): { normalizedPhone: string; amount: number } | null => {
    const next: ManualErrors = {};

    const trimmedPhone = phone.trim();
    const normalizedPhone = normalizeBulkPhone(trimmedPhone);
    if (!trimmedPhone) next.phone = 'Phone number is required.';
    else if (!normalizedPhone) {
      next.phone = 'Enter a valid Indian mobile number — 10 digits starting 6-9.';
    }

    const trimmedPoints = points.trim();
    const amount = Number(trimmedPoints);
    if (!trimmedPoints) next.points = 'Amount is required.';
    else if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
      next.points = 'Amount must be a whole number of coins.';
    } else if (amount < MIN_POINTS || amount > MAX_POINTS) {
      next.points = `Amount must be between ${MIN_POINTS} and ${MAX_POINTS.toLocaleString('en-IN')}.`;
    }

    if (!reason.trim()) next.reason = 'Reason is required.';

    setErrors(next);
    if (Object.keys(next).length > 0 || !normalizedPhone) return null;
    return { normalizedPhone, amount };
  };

  const submit = async () => {
    setSubmitError(null);
    setSuccess(null);
    const valid = validate();
    if (!valid) return;
    try {
      const result = await adjust.mutateAsync({
        phone: valid.normalizedPhone,
        input: { direction: opType, points: valid.amount, reason: reason.trim() },
      });
      setSuccess(
        `${opType === 'credit' ? 'Credited' : 'Debited'} ${valid.amount.toLocaleString(
          'en-IN',
        )} coins. New balance: ${result.newBalance.toLocaleString('en-IN')}.`,
      );
      setPoints('');
      setReason('');
    } catch (err) {
      // Field-specific server rejections belong on the field, not in a banner.
      if (err instanceof ApiException) {
        if (err.errorCode === 'INSUFFICIENT_BALANCE') {
          setErrors({ points: 'This customer does not have enough coins for that debit.' });
          return;
        }
        if (err.errorCode === 'INVALID_PHONE') {
          setErrors({ phone: 'Enter a valid Indian mobile number — 10 digits starting 6-9.' });
          return;
        }
      }
      setSubmitError(err instanceof Error ? err.message : 'Adjustment failed');
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
      <FieldRow
        label="Phone number"
        required
        error={errors.phone}
        hint="Indian mobile — with or without +91"
      >
        <Input
          aria-label="Manual phone"
          placeholder="9876543210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{ maxWidth: 260 }}
          {...(errors.phone ? { status: 'error' as const } : {})}
        />
      </FieldRow>

      <FieldRow label="Amount (coins)" required error={errors.points}>
        <Input
          aria-label="Manual amount"
          placeholder="500"
          inputMode="numeric"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          style={{ maxWidth: 200 }}
          {...(errors.points ? { status: 'error' as const } : {})}
        />
      </FieldRow>

      <FieldRow
        label="Reason"
        required
        error={errors.reason}
        hint="Shown on the customer's coin history"
      >
        <Input
          aria-label="Manual reason"
          placeholder="Goodwill credit"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          {...(errors.reason ? { status: 'error' as const } : {})}
        />
      </FieldRow>

      {submitError && <Alert type="error" showIcon message={submitError} />}
      {success && <Alert type="success" showIcon message={success} />}

      <div>
        <PrimaryButton onClick={() => void submit()} loading={adjust.isPending}>
          {opType === 'credit' ? 'Credit' : 'Debit'} coins
        </PrimaryButton>
      </div>
    </Space>
  );
}

// ─── Per-operation detail ───────────────────────────────────────────────────

const ROW_STATUS_COLOR: Record<string, string> = {
  pending: 'blue',
  success: 'green',
  failed: 'red',
  skipped: 'default',
};

const DETAIL_PAGE_SIZE = 50;

/**
 * The full customer list behind one bulk operation. The history row only shows
 * aggregates (coins, customers, ok/failed), so this answers "which customers
 * did that upload actually touch, and what happened to each?" — including the
 * per-row reason a debit failed.
 */
function OperationDetailModal({
  op,
  onClose,
  onPreviewErrors,
}: {
  op: BulkOperation | null;
  onClose: () => void;
  onPreviewErrors: (op: BulkOperation) => void;
}) {
  const [page, setPage] = useState(1);
  // `op` is null while closed, which keeps the query disabled.
  const rows = useBulkOpRows(op?.id ?? null, page, DETAIL_PAGE_SIZE);

  const close = () => {
    setPage(1);
    onClose();
  };

  const sign = op?.type === 'debit' ? '−' : '+';

  return (
    <Modal
      open={op !== null}
      onCancel={close}
      onOk={close}
      okText="Close"
      width={820}
      title={op ? `${op.type === 'debit' ? 'Debit' : 'Credit'} — ${op.fileName ?? op.id}` : ''}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      {op && (
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 12,
            }}
          >
            <DetailStat
              title="Total coins"
              value={`${sign}${op.totalPoints.toLocaleString('en-IN')}`}
            />
            <DetailStat title="Customers" value={op.validRows.toLocaleString('en-IN')} />
            <DetailStat title="Succeeded" value={op.successCount.toLocaleString('en-IN')} />
            <DetailStat title="Failed" value={op.failureCount.toLocaleString('en-IN')} />
          </div>

          <Table
            size="small"
            rowKey="rowNumber"
            loading={rows.isLoading}
            dataSource={rows.data?.items ?? []}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: <Empty description="No rows recorded for this operation" /> }}
            columns={[
              { title: 'Row', dataIndex: 'rowNumber', key: 'rowNumber', width: 70 },
              { title: 'Phone', dataIndex: 'phone', key: 'phone' },
              {
                title: 'Coins',
                dataIndex: 'points',
                key: 'points',
                render: (value: unknown) => Number(value).toLocaleString('en-IN'),
              },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (value: unknown) => (
                  <Tag color={ROW_STATUS_COLOR[String(value)] ?? 'default'}>{String(value)}</Tag>
                ),
              },
              {
                title: 'Reason',
                dataIndex: 'reason',
                key: 'reason',
                render: (value: unknown) => (value ? String(value) : '—'),
              },
              {
                title: 'Problem',
                dataIndex: 'errorReason',
                key: 'errorReason',
                render: (value: unknown) => (value ? String(value) : '—'),
              },
            ]}
            pagination={{
              current: page,
              pageSize: DETAIL_PAGE_SIZE,
              total: rows.data?.total ?? 0,
              onChange: (p) => setPage(p),
              showSizeChanger: false,
            }}
          />

          {op.failureCount > 0 && (
            <div>
              <Button
                onClick={() => {
                  onClose();
                  onPreviewErrors(op);
                }}
              >
                View failed rows CSV
              </Button>
            </div>
          )}
        </Space>
      )}
    </Modal>
  );
}

/**
 * Show the failed-rows CSV instead of dumping it into the browser's Downloads
 * folder. Clicking "errors.csv" used to be a one-way auto-download: to see why
 * five rows failed you had to leave the admin, find the file and open it in a
 * spreadsheet. The download is still here — as a button inside the preview,
 * where it is a choice rather than a side effect.
 */
function ErrorsCsvModal({ op, onClose }: { op: BulkOperation | null; onClose: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opId = op?.id ?? null;

  useEffect(() => {
    if (!opId) {
      setCsv(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setCsv(null);
    setError(null);
    fetchAuthenticatedText(`/api/bulk-operations/${opId}/errors.csv`)
      .then((text) => {
        if (!cancelled) setCsv(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the CSV');
      });
    return () => {
      cancelled = true;
    };
  }, [opId]);

  const lines = (csv ?? '').split('\n').filter((l) => l.trim().length > 0);
  const header = lines.length > 0 ? splitCsvLine(lines[0] as string) : [];
  const body = lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = { __key: String(index) };
    header.forEach((name, i) => {
      row[name] = cells[i] ?? '';
    });
    return row;
  });

  return (
    <Modal
      open={op !== null}
      onCancel={onClose}
      onOk={onClose}
      okText="Close"
      width={860}
      title={op ? `Failed rows — ${op.fileName ?? op.id}` : ''}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        {error && <Alert type="error" showIcon message={error} />}
        <Table
          size="small"
          rowKey="__key"
          data-testid="errors-csv-preview"
          loading={op !== null && csv === null && !error}
          dataSource={body}
          pagination={false}
          scroll={{ x: 'max-content', y: 400 }}
          locale={{ emptyText: <Empty description="No failed rows" /> }}
          columns={header.map((name) => ({
            title: name.replace(/_/g, ' '),
            dataIndex: name,
            key: name,
            render: (value: unknown) => (value ? String(value) : '—'),
          }))}
        />
        {op && (
          <div>
            <Button
              disabled={csv === null}
              onClick={() => downloadTextFile(csv ?? '', `bulk-${op.id}-errors.csv`)}
            >
              Download CSV
            </Button>
          </div>
        )}
      </Space>
    </Modal>
  );
}

function DetailStat({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
        {title}
      </Typography.Text>
      <Typography.Text strong style={{ fontSize: 18 }}>
        {value}
      </Typography.Text>
    </div>
  );
}

// ─── Progress + history ─────────────────────────────────────────────────────

function ProgressPanel({
  op,
  onPreviewErrors,
  onRefresh,
}: {
  op: BulkOperation;
  onPreviewErrors: (op: BulkOperation) => void;
  onRefresh: () => void;
}) {
  const total = op.validRows || op.totalRows;
  const percent = total > 0 ? Math.round((op.processedRows / total) * 100) : 0;
  const running = isRunningStatus(op.status);
  const stalled = isStalled(op.status, op.updatedAt);
  return (
    <Card title="Operation progress">
      <Space direction="vertical" size="small" style={{ display: 'flex' }}>
        <Typography.Text>
          Status: <StatusTag op={op} />
        </Typography.Text>
        {stalled && (
          // We stopped polling — say so, rather than leaving a progress bar
          // spinning against a job nothing is working on.
          <Alert
            type="warning"
            showIcon
            message="This operation has not progressed for a few minutes"
            description={
              <Space direction="vertical" size="small">
                <span>
                  Live updates are paused. The rows already applied are safe — the queue worker may
                  be busy or stopped.
                </span>
                <Button size="small" onClick={onRefresh}>
                  Check again
                </Button>
              </Space>
            }
          />
        )}
        <Typography.Text data-testid="bulk-progress">
          {op.processedRows} / {total} rows processed · {op.successCount} succeeded ·{' '}
          {op.failureCount} failed
        </Typography.Text>
        <Progress
          percent={op.status === 'done' ? 100 : percent}
          {...(running ? { status: 'active' as const } : {})}
        />
        {op.failureCount > 0 && (
          <Button onClick={() => onPreviewErrors(op)}>View failed rows CSV</Button>
        )}
      </Space>
    </Card>
  );
}

const historyColumns = (onPreviewErrors: (op: BulkOperation) => void) => [
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
    render: (_value: unknown, record: unknown) => <StatusTag op={record as BulkOperation} />,
  },
  {
    title: 'Coins',
    dataIndex: 'totalPoints',
    key: 'totalPoints',
    render: (_value: unknown, record: unknown) => {
      const op = record as BulkOperation;
      const sign = op.type === 'debit' ? '−' : '+';
      return (
        <Typography.Text strong>
          {sign}
          {op.totalPoints.toLocaleString('en-IN')}
        </Typography.Text>
      );
    },
  },
  {
    title: 'Customers',
    dataIndex: 'validRows',
    key: 'customers',
    render: (_value: unknown, record: unknown) => {
      const op = record as BulkOperation;
      return op.validRows.toLocaleString('en-IN');
    },
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
          onClick={(e) => {
            e.stopPropagation(); // the row click opens the detail modal
            onPreviewErrors(op);
          }}
        >
          errors.csv
        </Button>
      );
    },
  },
];
