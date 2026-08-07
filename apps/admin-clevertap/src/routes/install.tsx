import { Card, PrimaryButton, Space, Typography } from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ScriptTagPanel } from '@/components/ScriptTagPanel';
import { StatusPanel } from '@/components/StatusPanel';
import { useConfig } from '@/hooks/useConfig';
import { useMerchant } from '@/hooks/useMerchant';
import { useStatus } from '@/hooks/useStatus';

export const Route = createFileRoute('/install')({ component: InstallPage });

function InstallPage() {
  const merchant = useMerchant();
  const config = useConfig();
  const status = useStatus();

  if (merchant.isLoading || config.isLoading) return <Typography.Text>Loading…</Typography.Text>;
  if (!merchant.data) {
    return (
      <Typography.Text>
        Merchant session not found. Reinstall from the Ratio dashboard.
      </Typography.Text>
    );
  }

  if (!config.data?.accountId) {
    return (
      <Card
        title="Configure CleverTap first"
        extra={
          <Typography.Text type="secondary">
            We need your CleverTap Account ID before we can generate the install tag.
          </Typography.Text>
        }
      >
        <Link to="/config">
          <PrimaryButton>Go to config</PrimaryButton>
        </Link>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <ScriptTagPanel merchantId={merchant.data.id} />
      <StatusPanel
        status={status.data}
        isLoading={status.isLoading}
        error={status.error as Error | null}
      />
    </Space>
  );
}
