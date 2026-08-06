import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Spin, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useMerchant } from '@/hooks/useMerchant';
import { useReconciliationJob, useTriggerReconciliation } from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/reconciliation')({ component: ReconciliationPage });

const PRESETS = [
  { label: 'Last 1 hour', hours: 1 },
  { label: 'Last 2 hours', hours: 2 },
  { label: 'Last 6 hours', hours: 6 },
];

export function ReconciliationPage() {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id;
  const [jobId, setJobId] = useState<string | undefined>();
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const trigger = useTriggerReconciliation();
  const job = useReconciliationJob(jobId);

  function run(start: Date, end: Date) {
    if (!merchantId) return;
    trigger.mutate(
      { merchantId, timeRangeStart: start.toISOString(), timeRangeEnd: end.toISOString() },
      { onSuccess: (data) => setJobId(data.jobId) },
    );
  }

  function runPreset(hours: number) {
    const end = new Date();
    run(new Date(end.getTime() - hours * 60 * 60 * 1000), end);
  }

  function runCustom() {
    if (!customStart || !customEnd) return;
    run(new Date(customStart), new Date(customEnd));
  }

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Manual Reconciliation
        </Typography.Title>
        <Typography.Text type="secondary">
          Re-checks Ratio's own orders against what's already been pushed to Unicommerce for a time
          range, and pushes anything genuinely missing (e.g. from an outage). Runs the full check
          directly — unlike the automatic sweep that runs every 10 minutes in the background, this
          doesn't skip ahead on a quick count match first.
        </Typography.Text>
      </div>

      <Card title="Run a reconciliation">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          <Space wrap>
            {PRESETS.map((p) => (
              <Button
                key={p.hours}
                loading={trigger.isPending}
                disabled={!merchantId}
                onClick={() => runPreset(p.hours)}
              >
                {p.label}
              </Button>
            ))}
          </Space>

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              Custom range
            </Typography.Text>
            <Space wrap align="center">
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Range start"
              />
              <Typography.Text type="secondary">to</Typography.Text>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Range end"
              />
              <Button
                loading={trigger.isPending}
                disabled={!merchantId || !customStart || !customEnd}
                onClick={runCustom}
              >
                Run
              </Button>
            </Space>
          </div>

          {trigger.isError && (
            <Alert
              type="error"
              showIcon
              message="Couldn't start reconciliation"
              description={(trigger.error as Error).message}
            />
          )}
        </Space>
      </Card>

      {jobId && (
        <Card title="Result">
          {job.isLoading ? (
            <Spin />
          ) : job.isError ? (
            <Alert
              type="error"
              showIcon
              message="Couldn't load job status"
              description={(job.error as Error).message}
            />
          ) : job.data ? (
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              {job.data.status === 'RUNNING' && (
                <Alert
                  type="info"
                  showIcon
                  message="Running — checking orders in this range against what's been pushed to Unicommerce…"
                />
              )}
              {job.data.status === 'FAILED' && (
                <Alert
                  type="error"
                  showIcon
                  message="Reconciliation failed — check server logs for details."
                />
              )}
              {job.data.status === 'COMPLETED' && (
                <Alert
                  type={job.data.ordersPushedCount > 0 ? 'warning' : 'success'}
                  showIcon
                  message={
                    job.data.ordersPushedCount > 0
                      ? `Found and pushed ${job.data.ordersPushedCount} missing order(s).`
                      : "No missing orders found — everything's already synced."
                  }
                />
              )}
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Orders checked">
                  {job.data.ordersCheckedCount}
                </Descriptions.Item>
                <Descriptions.Item label="Already synced">
                  {job.data.ordersAlreadySyncedCount}
                </Descriptions.Item>
                <Descriptions.Item label="Newly pushed">
                  {job.data.ordersPushedCount}
                </Descriptions.Item>
                <Descriptions.Item label="Failed to enqueue">
                  {job.data.ordersFailedCount}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          ) : null}
        </Card>
      )}
    </Space>
  );
}
