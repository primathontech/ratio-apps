import { Card, PrimaryButton, Typography } from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ScriptTagPanel } from '@/components/ScriptTagPanel';
import { useForms } from '@/hooks/useForms';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/install')({ component: InstallPage });

export function InstallPage() {
  const merchant = useMerchant();
  const forms = useForms(1);

  if (merchant.isLoading || forms.isLoading) return <Typography.Text>Loading...</Typography.Text>;
  if (!merchant.data) {
    return (
      <Typography.Text>
        Merchant session not found. Reinstall from the Ratio dashboard.
      </Typography.Text>
    );
  }

  if ((forms.data?.forms.length ?? 0) === 0) {
    return (
      <Card
        title="Create a form first"
        extra={
          <Typography.Text type="secondary">
            You need at least one form before embedding.
          </Typography.Text>
        }
      >
        <Link to="/">
          <PrimaryButton>Go to forms</PrimaryButton>
        </Link>
      </Card>
    );
  }

  return <ScriptTagPanel merchantId={merchant.data.id} forms={forms.data?.forms ?? []} />;
}
