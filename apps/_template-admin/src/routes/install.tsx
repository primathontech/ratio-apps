import { Card, PrimaryButton, Typography } from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ScriptTagPanel } from '@/components/ScriptTagPanel';
import { useConfig } from '@/hooks/useConfig';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/install')({ component: InstallPage });

function InstallPage() {
  const merchant = useMerchant();
  const config = useConfig();

  if (merchant.isLoading || config.isLoading) return <Typography.Text>Loading…</Typography.Text>;
  if (!merchant.data) {
    return (
      <Typography.Text>
        Merchant session not found. Reinstall from the Ratio dashboard.
      </Typography.Text>
    );
  }

  if (!config.data?.apiKey) {
    return (
      <Card
        title="Configure Template first"
        extra={
          <Typography.Text type="secondary">
            You need Template credentials before we can generate the install tag.
          </Typography.Text>
        }
      >
        <Link to="/config">
          <PrimaryButton>Go to config</PrimaryButton>
        </Link>
      </Card>
    );
  }

  return <ScriptTagPanel merchantId={merchant.data.id} />;
}
