import { Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { DeliveryHealthPanel } from '@/components/DeliveryHealthPanel';
import { useDeliveryHealth } from '@/hooks/useDeliveryHealth';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/health')({ component: HealthPage });

function HealthPage() {
  const merchant = useMerchant();
  const health = useDeliveryHealth();

  if (merchant.isLoading) return <Typography.Text>Loading…</Typography.Text>;
  if (!merchant.data) {
    return (
      <Typography.Text>
        Merchant session not found. Reinstall from the Ratio dashboard.
      </Typography.Text>
    );
  }

  return (
    <DeliveryHealthPanel
      data={health.data}
      isLoading={health.isLoading}
      error={health.error as Error | null}
    />
  );
}
