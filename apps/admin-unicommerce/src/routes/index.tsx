import { Alert, Card, Col, PrimaryButton, Row, Space, Statistic, Tag, Typography } from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { useSyncStatus, usePreCheck, usePause, useResume, useDisconnect } from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/')({ component: Overview });

function Overview() {
  const token = useMerchantStore((s) => s.token);
  const merchantId = token ?? undefined;
  const status = useSyncStatus(merchantId);
  const preCheck = usePreCheck(merchantId);
  const pause = usePause(merchantId);
  const resume = useResume(merchantId);
  const disconnect = useDisconnect(merchantId);

  if (status.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const data = status.data;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Unicommerce Integration
        </Typography.Title>
        <Typography.Text type="secondary">
          Order sync and inventory management for Unicommerce.
        </Typography.Text>
      </div>

      {data && !data.connected && (
        <Alert
          type="warning"
          showIcon
          message="Not connected"
          description="Connect your Unicommerce account to start syncing orders and inventory."
        />
      )}

      {data?.circuitBreakerTripped && (
        <Alert
          type="error"
          showIcon
          message="Circuit breaker tripped"
          description="Too many consecutive failures. Sync is paused. Resume after resolving the issue."
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Connection Status" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic
                    title="Status"
                    value={data?.connected ? 'Connected' : 'Disconnected'}
                    valueStyle={{ fontSize: 16 }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Active"
                    value={data?.active ? 'Yes' : 'No'}
                    valueStyle={{ fontSize: 16 }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Kill Switch"
                    value={data?.killSwitch ? 'On' : 'Off'}
                    valueStyle={{ fontSize: 16, color: data?.killSwitch ? '#ff4d4f' : undefined }}
                  />
                </Col>
              </Row>
              {data?.tenantSlug && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Tenant: {data.tenantSlug} | Facility: {data.facilityCode}
                </Typography.Text>
              )}
              <Space wrap>
                {!data?.connected && (
                  <Link to="/config">
                    <PrimaryButton>Connect</PrimaryButton>
                  </Link>
                )}
                {data?.killSwitch ? (
                  <PrimaryButton loading={resume.isPending} onClick={() => resume.mutate()}>
                    Resume
                  </PrimaryButton>
                ) : data?.connected ? (
                  <PrimaryButton loading={pause.isPending} onClick={() => pause.mutate()} ghost>
                    Pause
                  </PrimaryButton>
                ) : null}
                {data?.connected && (
                  <PrimaryButton loading={disconnect.isPending} onClick={() => disconnect.mutate()} ghost danger>
                    Disconnect
                  </PrimaryButton>
                )}
              </Space>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Card title="Failed Sync Items" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <Statistic
                title="Failed Items"
                value={data?.failedItems?.length ?? 0}
                valueStyle={{ color: (data?.failedItems?.length ?? 0) > 0 ? '#ff4d4f' : undefined }}
              />
              {(data?.failedItems?.length ?? 0) > 0 && (
                <Link to="/sync">
                  <PrimaryButton ghost>View Failed Items</PrimaryButton>
                </Link>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {preCheck.data && (
        <Card title="Pre-flight Check">
          {preCheck.data.success ? (
            <Space direction="vertical" size="small">
              <Tag color="green">All good — {preCheck.data.totalSkusChecked} SKUs checked</Tag>
              {preCheck.data.warning && (
                <Typography.Text type="warning">{preCheck.data.warning}</Typography.Text>
              )}
            </Space>
          ) : (
            <Alert type="error" showIcon message={preCheck.data.error ?? 'Pre-check failed'} />
          )}
        </Card>
      )}
    </Space>
  );
}
