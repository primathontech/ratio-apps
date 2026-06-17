import { Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { ScriptTagPanel } from '@/components/ScriptTagPanel';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/install')({ component: InstallPage });

function InstallPage() {
  const merchant = useMerchant();

  if (merchant.isLoading) return <Typography.Text>Loading…</Typography.Text>;
  if (!merchant.data) {
    return (
      <Typography.Text>
        Merchant session not found. Reinstall from the Ratio dashboard.
      </Typography.Text>
    );
  }

  return <ScriptTagPanel merchantId={merchant.data.id} />;
}
